import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SIZE,
  createPlayableBoard,
  findMatches,
  hasPossibleMove,
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
