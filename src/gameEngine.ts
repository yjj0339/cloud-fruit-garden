export type Fruit = "blueberry" | "strawberry" | "peach" | "grape" | "lemon" | "apple";
export type Special = "row" | "column" | "flower";
export type Tile = { id: number; fruit: Fruit; special?: Special; foamLayers?: number };
export type Pos = { row: number; col: number };

export const BOARD_SIZE = 8;
export const FRUITS: Fruit[] = ["blueberry", "strawberry", "peach", "grape", "lemon", "apple"];

let tileId = 0;

export function makeTile(fruit?: Fruit): Tile {
  return { id: ++tileId, fruit: fruit ?? FRUITS[Math.floor(Math.random() * FRUITS.length)] };
}

export function cloneBoard(board: Tile[][]): Tile[][] {
  return board.map((row) => row.map((tile) => ({ ...tile })));
}

export function inside({ row, col }: Pos): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function isAdjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

export function key(pos: Pos): string {
  return `${pos.row}:${pos.col}`;
}

export function samePos(a: Pos | null, b: Pos): boolean {
  return Boolean(a && a.row === b.row && a.col === b.col);
}

export function findMatches(board: Tile[][]): Pos[][] {
  const groups: Pos[][] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    let start = 0;
    for (let col = 1; col <= BOARD_SIZE; col += 1) {
      if (col < BOARD_SIZE && board[row][col].fruit === board[row][start].fruit) continue;
      if (col - start >= 3) groups.push(Array.from({ length: col - start }, (_, index) => ({ row, col: start + index })));
      start = col;
    }
  }
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    let start = 0;
    for (let row = 1; row <= BOARD_SIZE; row += 1) {
      if (row < BOARD_SIZE && board[row][col].fruit === board[start][col].fruit) continue;
      if (row - start >= 3) groups.push(Array.from({ length: row - start }, (_, index) => ({ row: start + index, col })));
      start = row;
    }
  }
  return groups;
}

export function swapTiles(board: Tile[][], a: Pos, b: Pos): Tile[][] {
  const next = cloneBoard(board);
  [next[a.row][a.col], next[b.row][b.col]] = [next[b.row][b.col], next[a.row][a.col]];
  return next;
}

export function hasPossibleMove(board: Tile[][]): boolean {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const current = { row, col };
      if (board[row][col].special) return true;
      for (const next of [{ row: row + 1, col }, { row, col: col + 1 }]) {
        if (!inside(next)) continue;
        if (findMatches(swapTiles(board, current, next)).length > 0) return true;
      }
    }
  }
  return false;
}

const CLOUD_SLOTS: Pos[] = [
  { row: 2, col: 1 }, { row: 2, col: 6 }, { row: 5, col: 1 }, { row: 5, col: 6 },
  { row: 1, col: 3 }, { row: 1, col: 4 }, { row: 3, col: 0 }, { row: 3, col: 7 },
  { row: 4, col: 0 }, { row: 4, col: 7 }, { row: 6, col: 3 }, { row: 6, col: 4 },
];

function addFoam(board: Tile[][], foamTarget: number, levelId: number): void {
  const offset = (levelId * 3) % CLOUD_SLOTS.length;
  const slots = [...CLOUD_SLOTS.slice(offset), ...CLOUD_SLOTS.slice(0, offset)];
  let remaining = foamTarget;
  slots.forEach((pos, index) => {
    if (remaining <= 0) return;
    const minimumForRest = Math.max(0, slots.length - index - 1);
    const layers = Math.max(1, Math.min(2, remaining - minimumForRest));
    board[pos.row][pos.col].foamLayers = layers;
    remaining -= layers;
  });
}

export function createPlayableBoard(foamTarget = 5, levelId = 1): Tile[][] {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => makeTile()));
    if (findMatches(board).length > 0 || !hasPossibleMove(board)) continue;
    addFoam(board, foamTarget, levelId);
    if (levelId <= 3) board[4][4].special = "flower";
    return board;
  }
  throw new Error("Unable to create a playable match-three board.");
}

export function collapseBoard(board: Tile[][], cleared: Set<string>): Tile[][] {
  const next = cloneBoard(board);
  for (let col = 0; col < BOARD_SIZE; col += 1) {
    const fallen = next
      .map((row, rowIndex) => ({ tile: row[col], rowIndex }))
      .filter(({ rowIndex }) => !cleared.has(key({ row: rowIndex, col })))
      .map(({ tile }) => tile);
    const column = Array.from({ length: BOARD_SIZE - fallen.length }, () => makeTile()).concat(fallen);
    column.forEach((tile, row) => { next[row][col] = tile; });
  }
  return next;
}

export function reshuffleBoard(board: Tile[][]): Tile[][] {
  const foam = board.map((row) => row.map((tile) => tile.foamLayers));
  const pieces = board.flat().map(({ id, fruit, special }) => ({ id, fruit, special }));
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const shuffled = [...pieces];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    const next = Array.from({ length: BOARD_SIZE }, (_, row) =>
      Array.from({ length: BOARD_SIZE }, (_, col) => ({ ...shuffled[row * BOARD_SIZE + col], foamLayers: foam[row][col] })),
    );
    if (findMatches(next).length === 0 && hasPossibleMove(next)) return next;
  }
  return createPlayableBoard(foam.flat().reduce<number>((sum, layers) => sum + (layers || 0), 0));
}
