// "HELLO" in byte mode: version 1, level M, mask 4. Rendered to a PNG and decoded by Apple's Vision
// framework (VNDetectBarcodesRequest, macOS 27, October 2026) back to "HELLO", reading version 1,
// level M, and mask 4. Apple's CIQRCodeGenerator writes "HELLO" in alphanumeric mode, so it has no
// byte-mode twin to compare with.
// Rows from the top, "#" for a dark module. Written by the encoder, never by hand.
export const hello = {
  text: "HELLO",
  rows: [
    "#######.##.#..#######",
    "#.....#..##.#.#.....#",
    "#.###.#..####.#.###.#",
    "#.###.#.#..#..#.###.#",
    "#.###.#.#...#.#.###.#",
    "#.....#.#.##..#.....#",
    "#######.#.#.#.#######",
    "........#####........",
    "#...#.######.#####..#",
    "...###..#.###..#.####",
    "#.##..#.#.##..###..#.",
    "###..#...#...##.#....",
    "..#.###..#..###...##.",
    "........###.###..#.##",
    "#######.##..##...#.#.",
    "#.....#....##..#...#.",
    "#.###.#.#..#..###.#.#",
    "#.###.#....##....#.##",
    "#.###.#..###..####...",
    "#.....#..#...##......",
    "#######.#...#####.#.#",
  ],
}
