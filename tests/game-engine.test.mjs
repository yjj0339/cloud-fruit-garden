import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SIZE,
  createPlayableBoard,
  findMatches,
  hasPossibleMove,
  planMatches,
  reshuffleBoard,
  swapTiles,
} from "../src/gameEngine.ts";

test("new boards are full, stable, and contain at least one valid move", () => {
  for (let level = 1; level <= 20; level += 1) {
    const board = createPlayableBoard(Math.min(16, 5 + Math.floor((level - 1) * 0.6)), level);
    assert.equal(board.length, BOARD_SIZE);
    assert.ok(board.every((row) => row.length === BOARD_SIZE));
    assert.equal(findMatches(board).length, 0);
    assert.equal(hasPossibleMove(board), true);
  }
});

function boardOf() {
  const palette = ["blueberry", "strawberry", "peach", "grape", "lemon", "apple"];
  return Array.from({ length: BOARD_SIZE }, (_, row) => Array.from({ length: BOARD_SIZE }, (_, col) => ({
    id: row * BOARD_SIZE + col + 1,
    fruit: palette[(row * 2 + col * 3) % palette.length],
  })));
}

function setPattern(board, cells, fruit) {
  cells.forEach(([row, col]) => {
    board[row][col].fruit = fruit;
    for (const [nextRow, nextCol] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
      if (nextRow < 0 || nextRow >= BOARD_SIZE || nextCol < 0 || nextCol >= BOARD_SIZE) continue;
      if (!cells.some(([cellRow, cellCol]) => cellRow === nextRow && cellCol === nextCol) && board[nextRow][nextCol].fruit === fruit) {
        board[nextRow][nextCol].fruit = fruit === "apple" ? "blueberry" : "apple";
      }
    }
  });
}

test("three, four, five, and L/T matches create the expected tiers", () => {
  const three = boardOf();
  setPattern(three, [[3, 2], [3, 3], [3, 4]], "strawberry");
  assert.equal(planMatches(three, { row: 3, col: 3 }).spawns.length, 0);

  const four = boardOf();
  setPattern(four, [[2, 1], [2, 2], [2, 3], [2, 4]], "lemon");
  assert.deepEqual(planMatches(four, { row: 2, col: 4 }).spawns, [{ pos: { row: 2, col: 4 }, special: "row" }]);

  const five = boardOf();
  setPattern(five, [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6]], "peach");
  assert.deepEqual(planMatches(five, { row: 4, col: 6 }).spawns, [{ pos: { row: 4, col: 6 }, special: "flower" }]);

  const tee = boardOf();
  setPattern(tee, [[3, 2], [3, 3], [3, 4], [2, 3], [4, 3]], "apple");
  assert.deepEqual(planMatches(tee, { row: 3, col: 3 }).spawns, [{ pos: { row: 3, col: 3 }, special: "burst" }]);
});

test("an invalid adjacent swap is detected as having no match", () => {
  const board = createPlayableBoard(5, 1);
  let checked = false;
  for (let row = 0; row < BOARD_SIZE && !checked; row += 1) {
    for (let col = 0; col < BOARD_SIZE - 1 && !checked; col += 1) {
      const swapped = swapTiles(board, { row, col }, { row, col: col + 1 });
      if (findMatches(swapped).length === 0) checked = true;
    }
  }
  assert.equal(checked, true);
});

test("reshuffling removes existing matches and keeps a possible move", () => {
  const board = createPlayableBoard(12, 12);
  const shuffled = reshuffleBoard(board);
  assert.equal(findMatches(shuffled).length, 0);
  assert.equal(hasPossibleMove(shuffled), true);
  assert.deepEqual(
    shuffled.map((row) => row.map((tile) => tile.foamLayers || 0)),
    board.map((row) => row.map((tile) => tile.foamLayers || 0)),
  );
});
