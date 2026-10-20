// Writes the few protobuf shapes the tests build by hand: varints and length-delimited fields.

export const varint = (value: number): Array<number> => {
  const bytes: Array<number> = []
  let rest = value
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) + 0x80)
    rest = Math.floor(rest / 0x80)
  }
  bytes.push(rest)
  return bytes
}

export const field = (number: number, content: ReadonlyArray<number>): Array<number> => [
  ...varint(number * 8 + 2),
  ...varint(content.length),
  ...content,
]

export const text = (value: string): Array<number> => Array.from(value, (character) => character.charCodeAt(0))
