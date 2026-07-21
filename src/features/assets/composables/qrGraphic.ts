export type QrGraphic = { viewBox: string; path: string; label: string }

type QrVersion = {
  version: number
  dataCodewords: number
  ecCodewords: number
  blocks: number
  remainder: number
  align: number[]
}

const versions: QrVersion[] = [
  { version: 1, dataCodewords: 19, ecCodewords: 7, blocks: 1, remainder: 0, align: [] },
  { version: 2, dataCodewords: 34, ecCodewords: 10, blocks: 1, remainder: 7, align: [6, 18] },
  { version: 3, dataCodewords: 55, ecCodewords: 15, blocks: 1, remainder: 7, align: [6, 22] },
  { version: 4, dataCodewords: 80, ecCodewords: 20, blocks: 1, remainder: 7, align: [6, 26] },
  { version: 5, dataCodewords: 108, ecCodewords: 26, blocks: 1, remainder: 7, align: [6, 30] },
  { version: 6, dataCodewords: 136, ecCodewords: 18, blocks: 2, remainder: 7, align: [6, 34] },
  { version: 7, dataCodewords: 156, ecCodewords: 20, blocks: 2, remainder: 0, align: [6, 22, 38] },
  { version: 8, dataCodewords: 194, ecCodewords: 24, blocks: 2, remainder: 0, align: [6, 24, 42] },
  { version: 9, dataCodewords: 232, ecCodewords: 30, blocks: 2, remainder: 0, align: [6, 26, 46] }
]

const gf = (() => {
  const exp = Array<number>(512).fill(0)
  const log = Array<number>(256).fill(0)
  let value = 1
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value
    log[value] = index
    value <<= 1
    if (value & 0x100) value ^= 0x11d
  }
  for (let index = 255; index < exp.length; index += 1) exp[index] = exp[index - 255]
  return { exp, log }
})()

const multiply = (left: number, right: number): number => left && right ? gf.exp[gf.log[left] + gf.log[right]] : 0
const divisor = (degree: number): number[] => {
  const result = Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let index = 0; index < degree; index += 1) {
    for (let offset = 0; offset < result.length; offset += 1) {
      result[offset] = multiply(result[offset], root)
      if (offset + 1 < result.length) result[offset] ^= result[offset + 1]
    }
    root = multiply(root, 0x02)
  }
  return result
}

const errorCorrection = (data: number[], degree: number): number[] => {
  const coefficients = divisor(degree)
  const result = Array<number>(degree).fill(0)
  data.forEach((byte) => {
    const factor = byte ^ (result.shift() || 0)
    result.push(0)
    coefficients.forEach((coefficient, index) => { result[index] ^= multiply(coefficient, factor) })
  })
  return result
}

const utf8Bytes = (text: string): number[] => Array.from(new TextEncoder().encode(text))
const bitsForText = (bytes: number[]): number[] => {
  const bits = [0, 1, 0, 0]
  for (let shift = 7; shift >= 0; shift -= 1) bits.push((bytes.length >>> shift) & 1)
  bytes.forEach((byte) => { for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >>> shift) & 1) })
  return bits
}

const fitText = (text: string): { text: string; bytes: number[]; config: QrVersion } => {
  let value = text || '-'
  let bytes = utf8Bytes(value)
  let config = versions.find((item) => bitsForText(bytes).length <= item.dataCodewords * 8) || versions[versions.length - 1]
  const maxBytes = Math.floor((config.dataCodewords * 8 - 12) / 8)
  if (bytes.length <= maxBytes) return { text: value, bytes, config }
  while (value.length && utf8Bytes(`${value}...`).length > maxBytes) value = value.slice(0, -1)
  value = `${value}...`
  bytes = utf8Bytes(value)
  config = versions.find((item) => bitsForText(bytes).length <= item.dataCodewords * 8) || versions[versions.length - 1]
  return { text: value, bytes, config }
}

const codewordsFor = (text: string): { text: string; config: QrVersion; codewords: number[] } => {
  const fitted = fitText(text)
  const bits = bitsForText(fitted.bytes)
  const capacity = fitted.config.dataCodewords * 8
  for (let index = 0; index < Math.min(4, capacity - bits.length); index += 1) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let index = 0; index < bits.length; index += 8) data.push(bits.slice(index, index + 8).reduce((value, bit) => (value << 1) | bit, 0))
  for (let pad = 0; data.length < fitted.config.dataCodewords; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11)
  const blockSize = fitted.config.dataCodewords / fitted.config.blocks
  const blocks = Array.from({ length: fitted.config.blocks }, (_, index) => {
    const blockData = data.slice(index * blockSize, (index + 1) * blockSize)
    return { data: blockData, ec: errorCorrection(blockData, fitted.config.ecCodewords) }
  })
  const codewords: number[] = []
  for (let index = 0; index < blockSize; index += 1) blocks.forEach((block) => codewords.push(block.data[index]))
  for (let index = 0; index < fitted.config.ecCodewords; index += 1) blocks.forEach((block) => codewords.push(block.ec[index]))
  return { text: fitted.text, config: fitted.config, codewords }
}

const setModule = (matrix: boolean[][], reserved: boolean[][], row: number, column: number, value: boolean, isFunction = true): void => {
  matrix[row][column] = value
  if (isFunction) reserved[row][column] = true
}
const drawFinder = (matrix: boolean[][], reserved: boolean[][], row: number, column: number): void => {
  for (let y = -4; y <= 4; y += 1) for (let x = -4; x <= 4; x += 1) {
    const currentRow = row + y
    const currentColumn = column + x
    if (currentRow < 0 || currentColumn < 0 || currentRow >= matrix.length || currentColumn >= matrix.length) continue
    const distance = Math.max(Math.abs(x), Math.abs(y))
    setModule(matrix, reserved, currentRow, currentColumn, distance !== 2 && distance !== 4)
  }
}
const drawAlignment = (matrix: boolean[][], reserved: boolean[][], row: number, column: number): void => {
  for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) setModule(matrix, reserved, row + y, column + x, Math.max(Math.abs(x), Math.abs(y)) === 2 || (x === 0 && y === 0))
}
const formatBits = (mask = 0): number => {
  const data = (1 << 3) | mask
  let remainder = data
  for (let index = 0; index < 10; index += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  return ((data << 10) | remainder) ^ 0x5412
}
const drawFormat = (matrix: boolean[][], reserved: boolean[][], mask = 0): void => {
  const size = matrix.length
  const bits = formatBits(mask)
  const bit = (index: number): boolean => Boolean((bits >>> index) & 1)
  for (let index = 0; index <= 5; index += 1) setModule(matrix, reserved, 8, index, bit(index))
  setModule(matrix, reserved, 8, 7, bit(6)); setModule(matrix, reserved, 8, 8, bit(7)); setModule(matrix, reserved, 7, 8, bit(8))
  for (let index = 9; index < 15; index += 1) setModule(matrix, reserved, 14 - index, 8, bit(index))
  for (let index = 0; index < 8; index += 1) setModule(matrix, reserved, size - 1 - index, 8, bit(index))
  for (let index = 8; index < 15; index += 1) setModule(matrix, reserved, 8, size - 15 + index, bit(index))
  setModule(matrix, reserved, 8, size - 8, true)
}

export const createQrGraphic = (text: string): QrGraphic => {
  const { text: fittedText, config, codewords } = codewordsFor(text)
  const size = 21 + (config.version - 1) * 4
  const matrix = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  drawFinder(matrix, reserved, 3, 3); drawFinder(matrix, reserved, 3, size - 4); drawFinder(matrix, reserved, size - 4, 3)
  for (let index = 0; index < size; index += 1) {
    if (!reserved[6][index]) setModule(matrix, reserved, 6, index, index % 2 === 0)
    if (!reserved[index][6]) setModule(matrix, reserved, index, 6, index % 2 === 0)
  }
  config.align.forEach((row) => config.align.forEach((column) => {
    const overlapsFinder = (row === 6 && column === 6) || (row === 6 && column === size - 7) || (row === size - 7 && column === 6)
    if (!overlapsFinder) drawAlignment(matrix, reserved, row, column)
  }))
  drawFormat(matrix, reserved)
  const dataBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1))
  for (let index = 0; index < config.remainder; index += 1) dataBits.push(0)
  let bitIndex = 0
  let upward = true
  for (let column = size - 1; column >= 1; column -= 2) {
    if (column === 6) column -= 1
    for (let offset = 0; offset < size; offset += 1) {
      const row = upward ? size - 1 - offset : offset
      for (let currentColumn = column; currentColumn >= column - 1; currentColumn -= 1) {
        if (reserved[row][currentColumn]) continue
        matrix[row][currentColumn] = Boolean(dataBits[bitIndex] || 0) !== ((row + currentColumn) % 2 === 0)
        bitIndex += 1
      }
    }
    upward = !upward
  }
  const path: string[] = []
  matrix.forEach((row, y) => row.forEach((active, x) => { if (active) path.push(`M${x + 4} ${y + 4}h1v1H${x + 4}z`) }))
  return { viewBox: `0 0 ${size + 8} ${size + 8}`, path: path.join(''), label: fittedText.replace(/\s+/g, ' ').trim() }
}
