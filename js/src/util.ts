export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export const seqHelper = (arr: boolean[][], start = 0): number[][] => {
  const firstArray = arr[0];
  const result: number[][] = [];
  for (let idx = start; idx < firstArray.length; idx++){
    if (firstArray[idx]) {
      if (arr.length === 1){
        result.push([idx]);
      } else {
        const subResult = seqHelper(arr.slice(1), idx + 1);
        for (let i = 0; i < subResult.length; i++) {
          result.push([idx].concat(subResult[i]));
        }
      }
    }
  }
  return result;
}