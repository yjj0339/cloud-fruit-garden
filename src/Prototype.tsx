import { CSSProperties, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DotFilledIcon, LockClosedIcon, StarFilledIcon } from "@radix-ui/react-icons";
import {
  BOARD_SIZE,
  cloneBoard,
  collapseBoard,
  createPlayableBoard,
  findMatches,
  hasPossibleMove,
  inside,
  isAdjacent,
  key,
  makeTile,
  reshuffleBoard,
  samePos,
  swapTiles,
  type Fruit,
  type Pos,
  type Special,
  type Tile,
} from "./gameEngine";

type SavedGame = { unlocked: number; boosters: { hammer: number; flower: number; swap: number }; best: Record<number, number> };

const FRUIT_LABEL: Record<Fruit, string> = {
  blueberry: "蓝莓", strawberry: "草莓", peach: "蜜桃", grape: "葡萄", lemon: "柠檬", apple: "苹果",
};
const LEVELS = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  moves: Math.max(18, 27 - Math.floor(index / 2)),
  targets: [
    { kind: "strawberry" as const, label: "草莓", count: 12 + index },
    { kind: "foam" as const, label: "云朵泡沫", count: Math.min(16, 5 + Math.floor(index * 0.6)) },
  ],
  stars: [1050 + index * 210, 1800 + index * 260, 2800 + index * 330],
}));
const SAVE_KEY = "cloud-fruit-garden-save-v1";
const BOARD_WIDTH_PX = 812;
const BOARD_HEIGHT_PX = 914;
const CELL_WIDTH = BOARD_WIDTH_PX / BOARD_SIZE;
const CELL_HEIGHT = BOARD_HEIGHT_PX / BOARD_SIZE;
const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

function loadSave(): SavedGame {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
    const count = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 3;
    return { unlocked: Math.max(1, Math.min(20, Number(saved.unlocked) || 1)), boosters: { hammer: count(saved.boosters?.hammer), flower: count(saved.boosters?.flower), swap: count(saved.boosters?.swap) }, best: saved.best || {} };
  } catch { return { unlocked: 1, boosters: { hammer: 3, flower: 3, swap: 3 }, best: {} }; }
}

function cloudNeighbors(board: Tile[][], target: Set<string>) {
  const hits = new Set<string>();
  target.forEach((value) => {
    const [row, col] = value.split(":").map(Number);
    [{ row: row - 1, col }, { row: row + 1, col }, { row, col: col - 1 }, { row, col: col + 1 }].forEach((pos) => {
      if (inside(pos) && board[pos.row][pos.col].foamLayers) hits.add(key(pos));
    });
  });
  return hits;
}

function addSpecialEffect(board: Tile[][], pos: Pos, target: Set<string>) {
  const tile = board[pos.row][pos.col];
  if (!tile.special) return;
  if (tile.special === "row") for (let col = 0; col < BOARD_SIZE; col += 1) target.add(key({ row: pos.row, col }));
  if (tile.special === "column") for (let row = 0; row < BOARD_SIZE; row += 1) target.add(key({ row, col: pos.col }));
  if (tile.special === "flower") {
    const chosen = tile.fruit;
    for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col].fruit === chosen) target.add(key({ row, col }));
    }
  }
}

function playTone(kind: "move" | "match" | "win" | "lose") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    const values = { move: [440, 0.055], match: [660, 0.1], win: [880, 0.18], lose: [196, 0.16] } as const;
    osc.frequency.value = values[kind][0]; osc.type = kind === "lose" ? "sine" : "triangle";
    gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + values[kind][1]);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + values[kind][1]);
  } catch { /* Audio is optional in browsers that block it. */ }
}

function pulseHaptic(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { /* Haptics are optional. */ }
}

export default function Prototype() {
  const saved = useMemo(loadSave, []);
  const [view, setView] = useState<"map" | "game">("map");
  const [levelIndex, setLevelIndex] = useState(0);
  const level = LEVELS[levelIndex];
  const [board, setBoard] = useState<Tile[][]>(() => createPlayableBoard(LEVELS[0].targets[1].count, LEVELS[0].id));
  const [moves, setMoves] = useState(level.moves);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("收集水果，让云海重新闪亮吧！");
  const [showPause, setShowPause] = useState(false);
  const [showResult, setShowResult] = useState<"win" | "lose" | null>(null);
  const [booster, setBooster] = useState<"hammer" | "flower" | "swap" | null>(null);
  const [boosters, setBoosters] = useState(saved.boosters);
  const [unlocked, setUnlocked] = useState(saved.unlocked);
  const [bestScores, setBestScores] = useState<Record<number, number>>(saved.best);
  const dragStart = useRef<Pos | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<Pos | null>(null);
  const [dragVector, setDragVector] = useState({ x: 0, y: 0 });
  const [clearing, setClearing] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<"idle" | "swap" | "clear" | "fall" | "shuffle">("idle");
  const [chainDisplay, setChainDisplay] = useState(0);
  const [shakeBoard, setShakeBoard] = useState(false);
  const [progress, setProgress] = useState(() => ({ strawberry: 0, foam: 0 }));
  const audioEnabled = useRef(true);
  const latestLevel = useRef(level);
  latestLevel.current = level;

  const resetLevel = useCallback((nextIndex = levelIndex) => {
    const next = LEVELS[nextIndex];
    setBoard(createPlayableBoard(next.targets[1].count, next.id)); setMoves(next.moves); setScore(0); setSelected(null); setBusy(false); setBooster(null);
    setProgress({ strawberry: 0, foam: 0 }); setMessage("滑动相邻水果，完成三连消除"); setShowResult(null); setPhase("idle"); setChainDisplay(0);
  }, [levelIndex]);

  const openLevel = (index: number) => {
    if (index + 1 > unlocked) return;
    setLevelIndex(index); setView("game");
  };

  useEffect(() => { resetLevel(levelIndex); }, [levelIndex, resetLevel]);

  useEffect(() => { localStorage.setItem(SAVE_KEY, JSON.stringify({ unlocked, boosters, best: bestScores })); }, [unlocked, boosters, bestScores]);

  const goalsComplete = useCallback((nextProgress: { strawberry: number; foam: number }) => (
    nextProgress.strawberry >= level.targets[0].count && nextProgress.foam >= level.targets[1].count
  ), [level]);

  const registerProgress = useCallback((strawberry: number, foam: number) => {
    setProgress((value) => {
      const nextProgress = {
        strawberry: Math.min(level.targets[0].count, value.strawberry + strawberry),
        foam: Math.min(level.targets[1].count, value.foam + foam),
      };
      if (!goalsComplete(value) && goalsComplete(nextProgress)) {
        window.setTimeout(() => {
          setShowResult("win");
          setUnlocked((current) => Math.max(current, Math.min(20, levelIndex + 2)));
          if (audioEnabled.current) playTone("win");
          pulseHaptic([30, 45, 70]);
        }, 260);
      }
      return nextProgress;
    });
  }, [goalsComplete, level, levelIndex]);

  const resolveBoard = useCallback(async (initial: Tile[][], preferred?: Pos) => {
    let next = cloneBoard(initial);
    let chain = 0;
    let totalScore = 0;
    let gainedStrawberry = 0; let gainedFoam = 0;
    while (true) {
      const groups = findMatches(next);
      if (!groups.length) break;
      chain += 1;
      setChainDisplay(chain);
      const toClear = new Set<string>();
      const specials: { pos: Pos; special: Special }[] = [];
      groups.forEach((group) => {
        group.forEach((pos) => toClear.add(key(pos)));
        const origin = preferred && group.some((pos) => samePos(preferred ?? null, pos)) ? preferred : group[Math.floor(group.length / 2)];
        if (group.length >= 5) specials.push({ pos: origin, special: "flower" });
        else if (group.length === 4) specials.push({ pos: origin, special: group[0].row === group[1].row ? "row" : "column" });
      });
      [...toClear].forEach((value) => { const [row, col] = value.split(":").map(Number); addSpecialEffect(next, { row, col }, toClear); });
      cloudNeighbors(next, toClear).forEach((value) => toClear.add(value));
      const keep = new Map(specials.map((item) => [key(item.pos), item.special]));
      const cloudDamaged = new Set<string>();
      toClear.forEach((value) => {
        const [row, col] = value.split(":").map(Number); const current = next[row][col];
        if (keep.has(value)) { next[row][col] = { ...current, special: keep.get(value) }; return; }
        if (current.foamLayers) {
          gainedFoam += 1;
          next[row][col] = current.foamLayers > 1 ? { ...current, foamLayers: current.foamLayers - 1 } : { ...current, foamLayers: undefined };
          cloudDamaged.add(value);
          return;
        }
        if (current.fruit === "strawberry") gainedStrawberry += 1;
      });
      totalScore += toClear.size * 55 * chain;
      const cleared = new Set([...toClear].filter((value) => !keep.has(value) && !cloudDamaged.has(value)));
      setPhase("clear");
      setClearing(cleared);
      if (audioEnabled.current) playTone("match");
      pulseHaptic(chain > 1 ? [15, 25, 15] : 18);
      await new Promise((resolve) => window.setTimeout(resolve, 210));
      next = collapseBoard(next, cleared);
      setPhase("fall");
      setBoard(cloneBoard(next));
      setClearing(new Set());
      await new Promise((resolve) => window.setTimeout(resolve, 230));
      preferred = undefined;
    }
    if (!hasPossibleMove(next)) {
      setPhase("shuffle");
      setMessage("没有可消步骤，正在重新排列…");
      await new Promise((resolve) => window.setTimeout(resolve, 260));
      next = reshuffleBoard(next);
      setBoard(cloneBoard(next));
      await new Promise((resolve) => window.setTimeout(resolve, 260));
    }
    setPhase("idle");
    window.setTimeout(() => setChainDisplay(0), 520);
    if (totalScore) {
      setScore((value) => value + totalScore);
      registerProgress(gainedStrawberry, gainedFoam);
      setMessage(gainedFoam > 0 ? `云朵泡沫清除 × ${gainedFoam}！` : chain > 1 ? `云海连锁 × ${chain}！` : "漂亮的消除！");
    }
    return next;
  }, [registerProgress]);

  const swapAndResolve = useCallback(async (a: Pos, b: Pos) => {
    if (busy || !isAdjacent(a, b)) return;
    setBusy(true); setSelected(null); setPhase("swap");
    let next = swapTiles(board, a, b); setBoard(next);
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    const directSpecial = next[a.row][a.col].special || next[b.row][b.col].special;
    if (!directSpecial && !findMatches(next).length) {
      setMessage("这一步不能形成三连"); setShakeBoard(true); if (audioEnabled.current) playTone("lose");
      await new Promise((resolve) => window.setTimeout(resolve, 190)); setBoard(board); setShakeBoard(false); setPhase("idle"); setBusy(false); return;
    }
    setMoves((value) => Math.max(0, value - 1)); if (audioEnabled.current) playTone("move");
    if (directSpecial && !findMatches(next).length) {
      const target = new Set<string>([key(a), key(b)]); addSpecialEffect(next, a, target); addSpecialEffect(next, b, target);
      let foamHits = 0; let strawberryHits = 0;
      const cloudDamaged = new Set<string>();
      target.forEach((value) => {
        const [row, col] = value.split(":").map(Number); const tile = next[row][col];
        if (tile.foamLayers) { foamHits += 1; next[row][col] = tile.foamLayers > 1 ? { ...tile, foamLayers: tile.foamLayers - 1 } : { ...tile, foamLayers: undefined }; cloudDamaged.add(value); }
        else if (tile.fruit === "strawberry") strawberryHits += 1;
      });
      setClearing(target);
      await new Promise((resolve) => window.setTimeout(resolve, 210));
      const removable = new Set([...target].filter((value) => !cloudDamaged.has(value)));
      next = collapseBoard(next, removable);
      setScore((value) => value + target.size * 70); setBoard(next); setClearing(new Set());
      registerProgress(strawberryHits, foamHits);
      setMessage(foamHits ? `魔法特效清除了 ${foamHits} 朵云朵泡沫！` : "魔法特效触发！");
      if (findMatches(next).length) next = await resolveBoard(next);
      else if (!hasPossibleMove(next)) { setPhase("shuffle"); next = reshuffleBoard(next); setBoard(next); }
    } else await resolveBoard(next, b);
    setPhase("idle"); setBusy(false);
  }, [board, busy, registerProgress, resolveBoard]);

  const useBooster = useCallback(async (pos: Pos) => {
    if (!booster || busy || boosters[booster] <= 0) return false;
    const activeBooster = booster;
    if (activeBooster === "swap" && !selected) {
      setSelected(pos); setMessage("换一换：再选任意一个水果完成换位"); pulseHaptic(12); return true;
    }
    if (activeBooster === "swap" && selected && samePos(selected, pos)) {
      setMessage("请选择另一个水果"); return true;
    }
    setBusy(true); setPhase("clear");
    let next = cloneBoard(board);
    if (activeBooster === "swap" && selected) {
      next = swapTiles(next, selected, pos); setBoard(next); setSelected(null); setMessage("两个水果已换位"); pulseHaptic(20);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      setBoosters((value) => ({ ...value, swap: Math.max(0, value.swap - 1) })); setBooster(null);
      if (findMatches(next).length) next = await resolveBoard(next, pos);
      else if (!hasPossibleMove(next)) { setPhase("shuffle"); next = reshuffleBoard(next); setBoard(next); }
      setPhase("idle"); setBusy(false); return true;
    }
    if (activeBooster === "hammer") {
      const target = new Set([key(pos)]); const hitFoam = Boolean(next[pos.row][pos.col].foamLayers); setClearing(target); setMessage(hitFoam ? "小锤正在敲碎一层云朵泡沫…" : "小锤敲击中…"); if (audioEnabled.current) playTone("match");
      await new Promise((resolve) => window.setTimeout(resolve, 230)); const tile = next[pos.row][pos.col];
      if (tile.foamLayers) next[pos.row][pos.col] = tile.foamLayers > 1 ? { ...tile, foamLayers: tile.foamLayers - 1 } : { ...tile, foamLayers: undefined };
      else next = collapseBoard(next, target);
      setScore((value) => value + 90); registerProgress(0, hitFoam ? 1 : 0); pulseHaptic(25);
    }
    if (activeBooster === "flower") {
      const chosen = next[pos.row][pos.col].fruit; const target = new Set<string>();
      for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) if (next[row][col].fruit === chosen) target.add(key({ row, col }));
      setClearing(target); setMessage(`彩虹花正在清除全部${FRUIT_LABEL[chosen]}！`); if (audioEnabled.current) playTone("match");
      await new Promise((resolve) => window.setTimeout(resolve, 260));
      let foamHits = 0; let strawberryHits = 0; const removable = new Set<string>();
      for (let row = 0; row < BOARD_SIZE; row += 1) for (let col = 0; col < BOARD_SIZE; col += 1) if (target.has(key({ row, col }))) {
        const tile = next[row][col]; if (tile.foamLayers) { foamHits += 1; next[row][col] = tile.foamLayers > 1 ? { ...tile, foamLayers: tile.foamLayers - 1 } : { ...tile, foamLayers: undefined }; }
        else { removable.add(key({ row, col })); if (tile.fruit === "strawberry") strawberryHits += 1; }
      }
      next = collapseBoard(next, removable);
      setScore((value) => value + target.size * 75);
      registerProgress(strawberryHits, foamHits); pulseHaptic([15, 20, 30]);
    }
    setBoosters((value) => ({ ...value, [activeBooster]: Math.max(0, value[activeBooster] - 1) }));
    setBoard(next); setClearing(new Set()); setBooster(null); setMessage(activeBooster === "hammer" ? "小锤子生效！" : "彩虹花魔法完成！"); await new Promise((resolve) => window.setTimeout(resolve, 170));
    if (findMatches(next).length) await resolveBoard(next); else if (!hasPossibleMove(next)) { setPhase("shuffle"); next = reshuffleBoard(next); setBoard(next); }
    setPhase("idle"); setBusy(false); return true;
  }, [board, booster, boosters, busy, registerProgress, resolveBoard, selected]);

  const clickTile = async (pos: Pos) => {
    if (showResult) return;
    if (booster && await useBooster(pos)) return;
    if (!selected) { setSelected(pos); setMessage("选择一个相邻水果来交换。"); return; }
    if (samePos(selected, pos)) { setSelected(null); return; }
    if (!isAdjacent(selected, pos)) { setSelected(pos); return; }
    await swapAndResolve(selected, pos);
  };

  const tileFromPointer = (event: PointerEvent<HTMLDivElement>): Pos | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (BOARD_WIDTH_PX / rect.width);
    const y = (event.clientY - rect.top) * (BOARD_HEIGHT_PX / rect.height);
    const pos = { row: Math.floor(y / CELL_HEIGHT), col: Math.floor(x / CELL_WIDTH) };
    return inside(pos) ? pos : null;
  };
  const onBoardPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const pos = tileFromPointer(event); if (!pos || busy) return;
    dragStart.current = pos; dragOrigin.current = { x: event.clientX, y: event.clientY }; setDragging(pos); setDragVector({ x: 0, y: 0 }); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onBoardPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !dragOrigin.current || busy) return;
    const cell = Math.min(event.currentTarget.clientWidth, event.currentTarget.clientHeight) / BOARD_SIZE;
    const dx = Math.max(-cell, Math.min(cell, event.clientX - dragOrigin.current.x));
    const dy = Math.max(-cell, Math.min(cell, event.clientY - dragOrigin.current.y));
    setDragVector({ x: dx, y: dy });
  };
  const onBoardPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = dragStart.current; const to = tileFromPointer(event); const origin = dragOrigin.current; dragStart.current = null; dragOrigin.current = null; setDragging(null); setDragVector({ x: 0, y: 0 });
    if (!from || busy) return;
    const dx = event.clientX - (origin?.x ?? event.clientX); const dy = event.clientY - (origin?.y ?? event.clientY);
    const threshold = Math.min(event.currentTarget.clientWidth, event.currentTarget.clientHeight) / BOARD_SIZE * .28;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
      const destination = Math.abs(dx) > Math.abs(dy)
        ? { row: from.row, col: from.col + Math.sign(dx) }
        : { row: from.row + Math.sign(dy), col: from.col };
      if (inside(destination)) { void swapAndResolve(from, destination); return; }
    }
    void clickTile(from);
  };
  const onBoardPointerCancel = () => { dragStart.current = null; dragOrigin.current = null; setDragging(null); setDragVector({ x: 0, y: 0 }); };

  useEffect(() => { if (moves === 0 && !busy && !showResult && !goalsComplete(progress)) window.setTimeout(() => { setShowResult("lose"); if (audioEnabled.current) playTone("lose"); }, 260); }, [busy, goalsComplete, moves, progress, showResult]);
  useEffect(() => { setBestScores((value) => score > (value[level.id] || 0) ? { ...value, [level.id]: score } : value); }, [level.id, score]);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  }, []);

  const targetValues = useMemo(() => ({ strawberry: Math.min(progress.strawberry, level.targets[0].count), foam: Math.min(progress.foam, level.targets[1].count) }), [progress, level]);
  const stars = level.stars.filter((threshold) => score >= threshold).length;

  if (view === "map") return <LevelMap unlocked={unlocked} bestScores={bestScores} onOpenLevel={openLevel} />;

  return (
    <div className="native-scroll app-screen cloud-scroll">
      <main className="garden-game" aria-label="云海果乐园三消游戏" data-phase={phase}>
        <img className="scene-background" src={`${ASSET_BASE}backgrounds/sky-ocean-clean.png`} alt="" />
        <header className="game-hud" aria-label="当前关卡信息"><button className="hud-back" onClick={() => setView("map")} aria-label="返回关卡地图"><img src={`${ASSET_BASE}ui/back-button.png`} alt="" /></button><img className="hud-level-card" src={`${ASSET_BASE}ui/level-card-empty.png`} alt="" /><div className="hud-level-copy"><strong>第 {level.id} 关</strong><span>剩余 {moves} 步</span></div><section className="hud-mission"><img className="hud-mission-card" src={`${ASSET_BASE}ui/mission-card-empty.png`} alt="" /><img className="hud-mission-ribbon" src={`${ASSET_BASE}ui/mission-ribbon.png`} alt="" /><b>关卡目标</b><div className="live-targets"><span><img src={`${ASSET_BASE}tiles/foam.png`} alt="" />{targetValues.foam}/{level.targets[1].count}</span><span><img src={`${ASSET_BASE}tiles/strawberry.png`} alt="" />{targetValues.strawberry}/{level.targets[0].count}</span></div></section><img className="hud-whale" src={`${ASSET_BASE}ui/whale-bubble.png`} alt="云海小鲸鱼" /></header>
        <div className="game-guidance"><p className="game-message" aria-live="polite">{message}</p>{progress.foam < level.targets[1].count && <div className="foam-tip" role="note"><img src={`${ASSET_BASE}tiles/foam.png`} alt="" /><span>云朵旁消除削 1 层；数字 2 需两次</span></div>}</div>
        {chainDisplay > 1 && <div className="chain-badge" aria-live="polite">连消 × {chainDisplay}</div>}
        {booster && <div className="booster-hint" aria-live="polite">{booster === "hammer" ? "小锤已选中：点任意水果或泡沫" : booster === "flower" ? "彩虹花已选中：点一种水果全屏清除" : "交换已选中：先点一个水果"}</div>}
        <section className="board-frame" aria-label="水果消除棋盘">
          <div className={`game-board ${busy ? "is-busy" : ""} ${shakeBoard ? "is-shaking" : ""}`} onPointerDown={onBoardPointerDown} onPointerMove={onBoardPointerMove} onPointerUp={onBoardPointerUp} onPointerCancel={onBoardPointerCancel}>
            {board.flatMap((row, rowIndex) => row.map((tile, colIndex) => {
              const pos = { row: rowIndex, col: colIndex };
              const style = { "--tile-row": rowIndex, "--tile-col": colIndex, "--drag-x": `${dragging && samePos(dragging, pos) ? dragVector.x : 0}px`, "--drag-y": `${dragging && samePos(dragging, pos) ? dragVector.y : 0}px` } as CSSProperties;
              return <button key={tile.id} style={style} className={`tile ${clearing.has(key(pos)) ? "is-clearing" : ""} ${selected && samePos(selected, pos) ? "is-selected" : ""} ${dragging && samePos(dragging, pos) ? "is-dragging" : ""} ${tile.special ? `special-${tile.special}` : ""}`} disabled={busy} tabIndex={selected && samePos(selected, pos) ? 0 : rowIndex === 0 && colIndex === 0 ? 0 : -1} aria-label={`${FRUIT_LABEL[tile.fruit]}，第 ${rowIndex + 1} 行第 ${colIndex + 1} 列`}>
                <img src={`${ASSET_BASE}tiles/${tile.special === "flower" ? "rainbow-flower" : tile.fruit === "grape" ? "grape-cluster" : tile.fruit === "apple" ? "red-apple" : tile.fruit}.png`} alt="" />
                {tile.foamLayers && <span className={`cloud-layer cloud-layer-${tile.foamLayers}`} aria-label={`云朵障碍，还需要 ${tile.foamLayers} 次消除`}><img src={`${ASSET_BASE}tiles/foam.png`} alt="" /><em>{tile.foamLayers > 1 ? tile.foamLayers : ""}</em></span>}
              </button>;
            }))}
          </div>
        </section>
        <section className="ocean-friends" aria-hidden="true"><img className="friend-turtle" src={`${ASSET_BASE}ui/turtle-island.png`} alt="" /><img className="friend-jelly" src={`${ASSET_BASE}ui/jellyfish.png`} alt="" /><img className="friend-seahorse" src={`${ASSET_BASE}ui/seahorse-island.png`} alt="" /></section>
        <footer className="booster-dock">
          <Booster label="小锤敲击" asset="ui/booster-hammer" count={boosters.hammer} active={booster === "hammer"} unavailable={busy} onClick={() => setBooster(booster === "hammer" ? null : "hammer")} />
          <Booster label="彩虹花" asset="ui/booster-wand" count={boosters.flower} active={booster === "flower"} unavailable={busy} onClick={() => setBooster(booster === "flower" ? null : "flower")} />
          <Booster label="换一换" asset="ui/booster-swap" count={boosters.swap} active={booster === "swap"} unavailable={busy} onClick={() => setBooster(booster === "swap" ? null : "swap")} />
          <button className="pause-button" onClick={() => setShowPause(true)} aria-label="暂停游戏"><img src={`${ASSET_BASE}ui/pause-button.png`} alt="" /></button>
        </footer>
        {showPause && <Modal title="云海暂歇" onClose={() => setShowPause(false)}><p>第 {level.id} 关进行中，已经获得 {score} 分。</p><button onClick={() => { audioEnabled.current = !audioEnabled.current; setMessage(audioEnabled.current ? "声音已开启" : "声音已关闭"); }}>切换声音</button><button onClick={() => { setShowPause(false); resetLevel(); }}>重新开始</button><button onClick={() => { setShowPause(false); setView("map"); }}>返回关卡地图</button></Modal>}
        {showResult && <Result kind={showResult} stars={stars} score={score} onRetry={() => resetLevel()} onNext={() => { if (levelIndex < LEVELS.length - 1) setLevelIndex((value) => value + 1); else { setShowResult(null); setView("map"); } }} />}
      </main>
    </div>
  );
}

function LevelMap({ unlocked, bestScores, onOpenLevel }: { unlocked: number; bestScores: Record<number, number>; onOpenLevel: (index: number) => void }) {
  const [notice, setNotice] = useState("");
  const announce = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(""), 1800); };
  return <div className="native-scroll app-screen cloud-scroll"><main className="level-map-screen" aria-label="云海果乐园关卡地图">
    <MapScenery />
    <header className="map-topbar"><div><b>云海果乐园</b><small>完成关卡，点亮下一座果岛</small></div><button onClick={() => announce("今日礼物已放入背包！")} aria-label="每日礼物">礼物</button></header>
    <section className="map-actions" aria-label="地图活动"><button onClick={() => announce("每日任务：完成 3 次水果消除") }><span>每日任务</span><b>3</b></button><button onClick={() => announce("果园宝箱将在通关后开启") }><span>果园宝箱</span><b>★</b></button><button onClick={() => announce("活动：云海寻宝已开启") }><span>活动</span><b>!</b></button></section>
    <section className="map-levels" aria-label="20 个关卡">{LEVELS.map((item, index) => <button key={item.id} className={`map-level ${item.id <= unlocked ? "unlocked" : "locked"} ${bestScores[item.id] ? "finished" : ""}`} disabled={item.id > unlocked} onClick={() => onOpenLevel(index)}><span>{item.id}</span><i aria-hidden="true">{bestScores[item.id] ? <StarFilledIcon /> : item.id <= unlocked ? <DotFilledIcon /> : <LockClosedIcon />}</i></button>)}</section>
    {notice && <p className="map-notice" aria-live="polite">{notice}</p>}
    <div className="map-footer"><span>当前已解锁 {unlocked}/20 关</span><button onClick={() => onOpenLevel(Math.max(0, unlocked - 1))}>继续冒险</button></div>
  </main></div>;
}

function MapScenery() {
  return <div className="map-scenery" aria-hidden="true">
    <img className="map-path-art" src={`${ASSET_BASE}map/golden-path.png`} alt="" />
    <img className="map-orchard map-orchard-apple-a" src={`${ASSET_BASE}map/orchard-apple.png`} alt="" />
    <img className="map-orchard map-orchard-blueberry-a" src={`${ASSET_BASE}map/orchard-blueberry.png`} alt="" />
    <img className="map-orchard map-orchard-apple-b" src={`${ASSET_BASE}map/orchard-apple.png`} alt="" />
    <img className="map-orchard map-orchard-blueberry-b" src={`${ASSET_BASE}map/orchard-blueberry.png`} alt="" />
    <img className="map-whale" src={`${ASSET_BASE}ui/whale-bubble.png`} alt="" />
    <img className="map-turtle" src={`${ASSET_BASE}ui/turtle-island.png`} alt="" />
    <img className="map-seahorse" src={`${ASSET_BASE}ui/seahorse-island.png`} alt="" />
    <img className="map-flower map-flower-a" src={`${ASSET_BASE}tiles/rainbow-flower.png`} alt="" />
    <img className="map-flower map-flower-b" src={`${ASSET_BASE}tiles/rainbow-flower.png`} alt="" />
  </div>;
}

function Goal({ icon, value, total }: { icon: "strawberry" | "foam"; value: number; total: number }) { return <div className="goal"><img src={`${ASSET_BASE}tiles/${icon === "foam" ? "foam" : icon}.png`} alt="" /><b>{value}/{total}</b></div>; }
function Booster({ label, asset, count, active, unavailable, onClick }: { label: string; asset: string; count: number; active: boolean; unavailable: boolean; onClick: () => void }) { return <button className={`booster ${active ? "is-active" : ""}`} onClick={onClick} aria-pressed={active} disabled={unavailable || count <= 0} aria-label={`${label}，剩余 ${count} 个`}><span><img src={`${ASSET_BASE}${asset}.png`} alt="" /><b>{count}</b></span><small>{count > 0 ? label : "已用完"}</small></button>; }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop" role="presentation"><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2>{children}<button className="modal-close" onClick={onClose}>继续冒险</button></section></div>; }
function Result({ kind, stars, score, onRetry, onNext }: { kind: "win" | "lose"; stars: number; score: number; onRetry: () => void; onNext: () => void }) { const won = kind === "win"; return <div className="modal-backdrop"><section className="result-card" role="dialog" aria-modal="true" aria-label={won ? "挑战成功" : "差一点就成功了"}><div className="result-bubble">{won ? "云海闪亮！" : "再试一次"}</div><h2>{won ? "挑战成功" : "差一点就成功了"}</h2><p className="result-stars">{"★".repeat(stars)}{"☆".repeat(3 - stars)}</p><p>本关得分 {score.toLocaleString()}</p><div><button onClick={onRetry}>重新挑战</button>{won && <button onClick={onNext}>下一关</button>}</div></section></div>; }
