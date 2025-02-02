import {
  amalgamatingBinaryOperators,
  binaryExpressionStrings,
  simpleBinaryOperators,
  unaryExpressions,
} from "./constants";
import { OpenAnIssueIfThisOccursError, ParseError } from "./errors";
import { lex } from "./lexer";
import { ASTExpression, LexToken } from "./types";

const amalgamationTechniques: {
  [key: string]: (start: ASTExpression[]) => ASTExpression;
} = {
  " ": (asts) => ({
    type: "application",
    function: asts[0],
    arguments: asts.slice(1),
  }),
  "|": (asts) => ({
    type: "pipeline",
    stages: asts,
  }),
};

type ParseResult = {
  result: ASTExpression;
  remaining: LexToken[];
};

type Parser = (tokens: LexToken[]) => ParseResult;

const tmatch = (token: string, value: unknown, root: LexToken) => {
  return (root !== undefined) && root.token === token && root.value === value;
};

const isBinExp = (token: LexToken) => {
  const res =
    token.token === "special" &&
    binaryExpressionStrings.indexOf(token.value) > -1;
  return res;
};

const isUnExp = (token: LexToken) => {
  const res =
    token.token === "special" && unaryExpressions.indexOf(token.value) > -1;
  return res;
};

const consumeParenthetical: Parser = (tokens: LexToken[]) => {
  let current = tokens;
  if (!tmatch("special", "(", current[0])) {
    throw new OpenAnIssueIfThisOccursError("Parenthetical Issue");
  }
  current = current.slice(1);
  const { result, remaining } = consumeExpression(current);
  current = remaining;
  if (!current[0]) {
    throw new ParseError("Unexpected EOF");
  }
  if (!tmatch("special", ")", current[0])) {
    throw new ParseError("Expected )");
  }
  current = current.slice(1);
  return {
    result,
    remaining: current,
  };
};

const consumeArray: Parser = (tokens) => {
  if (!tmatch("special", "[", tokens[0])) {
    throw new OpenAnIssueIfThisOccursError("BracketStart Issue");
  }
  let current = tokens.slice(1);
  let entries: ASTExpression[] = [];
  // dirty explicit check for an empty array -- should be fixed up
  while (true) {
    if (tmatch("special", "]", current[0])) {
      current = current.slice(1);
      break;
    }
    const { result, remaining } = consumeExpression(current);
    entries.push(result);
    current = remaining;
    if (tmatch("special", ",", current[0])) {
      current = current.slice(1);
      continue;
    } else if (tmatch("special", "]", current[0])) {
      current = current.slice(1);
      break;
    } else {
      throw new ParseError("Unexpected token " + current[0].value)
    }
  }
  return {
    result: {
      type: "literal",
      valueType: "array",
      value: entries,
    },
    remaining: current,
  };
};

const consumeStruct: Parser = (tokens) => {
  if (!tmatch("special", "{", tokens[0])) {
    throw new OpenAnIssueIfThisOccursError("BracketStart Issue");
  }
  let current = tokens.slice(1);
  let entries: {[key: string]: ASTExpression} = {};
  while (true) {
    if (tmatch("special", "}", current[0])) {
      current = current.slice(1);
      break;
    }
    if (current[0] === undefined){
      throw new ParseError("Unexpected EOF");
    }
    let key: string;
    if (current[0].token === 'ref' || current[0].token === 'value') {
      key = current[0].value.toString();
      current = current.slice(1);
    } else {
      throw new ParseError("Unexpected token " + current[0].value);
    }
    if (tmatch("special", ":", current[0])) {
      current = current.slice(1);
    } else {
      throw new ParseError("Unexpected token " + current[0].value + ", expected :")
    }
    const { result, remaining } = consumeExpression(current);
    entries[key] = result;
    current = remaining;
    if (tmatch("special", ",", current[0])) {
      current = current.slice(1);
      continue;
    } else if (tmatch("special", "}", current[0])) {
      current = current.slice(1);
      break;
    } else {
      throw new ParseError("Unexpected token " + current[0].value)
    }
  }
  return {
    result: {
      type: "literal",
      valueType: "struct",
      value: entries,
    },
    remaining: current,
  };
};

// This might be the worst function i've ever written.
// But at least it's a contained transformation.
type BinaryExpressionSequence = { items: ASTExpression[]; joiners: string[] };

const turnBinaryExpressionSequenceIntoASTExpression = (
  bexpseq: BinaryExpressionSequence
): ASTExpression => {
  if (bexpseq.items.length === 0) {
    throw new ParseError("Tried to parse empty expression!");
  }
  if (bexpseq.items.length === 1) {
    // this is the majority case by a long shot.
    return bexpseq.items[0];
  }
  let current = bexpseq;

  // First Stage: Simple Binary Expressions -> Applications
  for (let i = 0; i < simpleBinaryOperators.length; i++) {
    const currentExpression = simpleBinaryOperators[i];
    const newItems = [current.items[0]];
    const newJoiners = [];

    for (let j = 0; j < current.joiners.length; j++) {
      newItems.push(current.items[j + 1]);
      if (current.joiners[j] === currentExpression) {
        const l = newItems[newItems.length - 2];
        const r = newItems[newItems.length - 1];
        newItems[newItems.length - 2] = {
          type: "application",
          function: {
            type: "reference",
            ref: currentExpression,
          },
          arguments: [l, r],
        };
        newItems.length = newItems.length - 1;
      } else {
        newJoiners.push(current.joiners[j]);
      }
    }
    current = {
      items: newItems,
      joiners: newJoiners,
    };
  }

  // Second Stage: Amalgamating Binary Expressions
  for (let i = 0; i < amalgamatingBinaryOperators.length; i++) {
    const currentExpression = amalgamatingBinaryOperators[i];
    const newItems = [current.items[0]];
    const newJoiners = [];
    const amalgamationTechnique = amalgamationTechniques[currentExpression]!;
    let streak: ASTExpression[] = [];
    const flushStreak = () => {
      if (streak.length > 0) {
        newItems.push(amalgamationTechnique(streak));
        streak = [];
      }
    };
    for (let j = 0; j < current.joiners.length; j++) {
      if (current.joiners[j] === currentExpression) {
        if (streak.length === 0) {
          streak.push(current.items[j]);
          newItems.pop();
        }
        streak.push(current.items[j + 1]);
      } else {
        // Flush the current streak.
        flushStreak();
        newItems.push(current.items[j + 1]);
        newJoiners.push(current.joiners[j]);
      }
    }
    flushStreak();
    current = {
      items: newItems,
      joiners: newJoiners,
    };
  }
  return current.items[0];
};

const consumeExpression: Parser = (tokens) => {
  let current = tokens;
  let items: ASTExpression[] = [];
  let joiners: LexToken[] = [];

  const itemPushGuard = (token: LexToken) => {
    if (joiners.length !== items.length) {
      // Now parsing an item, so guard
      throw new ParseError("Unexpected Token " + token.value);
    }
  };

  const binExpDoesntMakeSense = () => {
    return joiners.length + 1 !== items.length;
  };

  const joinerPushGuard = (token: LexToken) => {
    if (binExpDoesntMakeSense()) {
      // Now parsing an item, so guard
      throw new ParseError("Unexpected Token " + token.value);
    }
  };
  while (current.length > 0) {
    let next = current[0];

    // --- NASTY HACK ALERT ---
    // Weird dirty hack that should be sorted out.
    // only if binary expression WOULD throw, parse as a unary as a "backup"
    let hackyUnaryPostProcess:
      | ((ast: ASTExpression) => ASTExpression)
      | undefined = undefined;
    if (isUnExp(next) && binExpDoesntMakeSense()) {
      // turn all further unaries into a big ol' stack.
      let i = 0; // index of first non-unary item.
      for (; i < current.length; i++) {
        if (!isUnExp(current[i])) {
          break;
        }
      }
      const unaries = current.slice(0, i);
      current = current.slice(i);
      next = current[0];
      hackyUnaryPostProcess = (item) =>
        unaries.reduce(
          (acc, cur) => ({
            type: "application",
            function: {
              type: "reference",
              ref: (cur.value as string) + "/unary",
            },
            arguments: [acc],
          }),
          item
        );
    }

    if (isBinExp(next) && !hackyUnaryPostProcess) {
      joinerPushGuard(next);
      joiners.push(next);
      current = current.slice(1);
    } else if (tmatch("special", "(", next)) {
      itemPushGuard(next);
      const { result, remaining } = consumeParenthetical(current);
      items.push(result);
      current = remaining;
    } else if (tmatch("special", "[", next)) {
      itemPushGuard(next);
      const { result, remaining } = consumeArray(current);
      items.push(result);
      current = remaining;
    }else if (tmatch("special", "{", next)) {
      itemPushGuard(next);
      const { result, remaining } = consumeStruct(current);
      items.push(result);
      current = remaining;
    } else if (next.token === "value") {
      itemPushGuard(next);
      items.push({
        type: "literal",
        valueType: next.value !== null ? (typeof next.value as any) : "null",
        value: next.value,
      });
      current = current.slice(1);
    } else if (next.token === "ref") {
      itemPushGuard(next);
      items.push({
        type: "reference",
        ref: next.value,
      });
      current = current.slice(1);
    } else {
      break;
      // An unexpected token! Stop parsing this expression
    }
    // This is incredibly gross
    if (hackyUnaryPostProcess) {
      items[items.length - 1] = hackyUnaryPostProcess(items[items.length - 1]);
    }
  }

  return {
    result: turnBinaryExpressionSequenceIntoASTExpression({
      items,
      // We know the below is a string because we only add specials
      joiners: joiners.map((joiner) => joiner.value as string),
    }),
    remaining: current.slice(),
  };
};

function parseQuery(tokens: LexToken[]): ASTExpression {
  const { result, remaining } = consumeExpression(tokens);
  if (remaining.length !== 0) {
    throw new ParseError("Unexpected token " + remaining[0].value + ", expected EOF");
  }
  return result;
}

function parse(raw: string): ASTExpression {
  const lexed = lex(raw);
  const parsed = parseQuery(lexed);
  return parsed;
}

export const parseOrThrow = parse;
