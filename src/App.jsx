import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Trash2, Star, Shuffle, Calendar, BookOpen, Layers,
  CheckCircle2, Circle, X, ChevronDown, ChevronRight, ChevronLeft,
  Save, ClipboardList, Users, Edit3, UserPlus, Repeat, Palette, AlertTriangle,
  Download, Share2, Image as ImageIcon, Settings, GripVertical
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { toPng } from "html-to-image";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap');`;

// FAIR ROTATION ENGINE — targets equal minutes for everyone across the whole
// match day (not just one game), keeps a continuously-playing player in the
// same role until they're actually subbed, and hands an incoming player the
// exact spot vacated by whoever they're replacing (which naturally reproduces
// "swap as a pair" behaviour when bench size is 2, and "swap one at a time"
// when bench size is 1 — without hard-coding either case).
// Formats a decimal minute value as m:ss (3.333 -> "3:20")
function fmtTime(mins) {
  const total = Math.round(mins * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Suggests how many rotation blocks divide the squad evenly. With 6 players and
// 2 bench slots that's 3 blocks (everyone sits exactly once); with 5 players and
// 1 bench slot it's 5 blocks. Falls back sensibly when it doesn't divide cleanly.
function suggestedBlocks(numPlayers, numPositions) {
  const bench = numPlayers - numPositions;
  if (bench <= 0) return 1;
  return Math.max(1, Math.round(numPlayers / bench));
}

// ROTATION ENGINE
//
// Selection priority, in order:
//   1. Bench starts  — whoever has started the most games on the bench today is
//      first in line to start the next one on the pitch. This is the PRIMARY
//      rule, not a tie-breaker, which is what stops the same kids opening on the
//      bench in back-to-back games.
//   2. Striker starts — among those starting, the ST shirt goes to whoever has
//      started fewest games up front today.
//   3. Minutes       — only a loose balancer for ties, deliberately last. Chasing
//      exact minute-equality was causing more churn than it was worth.
//
// Fairness is scoped to a single match day on purpose: squads are drawn from a
// large pool week to week, so carrying history across days would unfairly
// penalise the kids who turn up every week.
function generateRotationPlan(presentPlayers, formatPositions, duration, numBlocks, existingMatchdayGames = []) {
  const requiredPositions = formatPositions || [];
  const P = requiredPositions.length;
  const N = presentPlayers.length;
  if (N < P || P === 0) return null;

  const g = N - P; // bench size at any moment
  const blocks = g <= 0 ? 1 : Math.max(1, Math.round(numBlocks) || 1);
  const blockLength = duration / blocks;

  // ---- History from earlier games THIS match day ----
  const minutes = {};
  const positionCount = {};
  const benchStarts = {};
  const strikerStarts = {};
  presentPlayers.forEach((p) => {
    minutes[p.id] = 0;
    positionCount[p.id] = {};
    benchStarts[p.id] = 0;
    strikerStarts[p.id] = 0;
  });

  const isStriker = (pos) => pos === "ST" || pos === "CF";

  existingMatchdayGames.forEach((game) => {
    (game.intervals || []).forEach((iv, ivIdx) => {
      const mins = (iv.endMin ?? 0) - (iv.startMin ?? 0);
      (iv.onField || []).forEach((of) => {
        if (minutes[of.playerId] === undefined) return; // wasn't present today
        minutes[of.playerId] += mins;
        positionCount[of.playerId][of.position] = (positionCount[of.playerId][of.position] || 0) + 1;
        if (ivIdx === 0 && isStriker(of.position)) strikerStarts[of.playerId] += 1;
      });
      if (ivIdx === 0) {
        (iv.benched || []).forEach((playerId) => {
          if (benchStarts[playerId] === undefined) return;
          benchStarts[playerId] += 1;
        });
      }
    });
  });

  // ---- Pick who starts on the pitch ----
  // Sorted most-deserving-to-play first: most bench starts, then fewest minutes,
  // then random. The last `g` in this list start on the bench.
  const ranked = [...presentPlayers].sort((a, b) => {
    const benchDiff = benchStarts[b.id] - benchStarts[a.id];
    if (benchDiff !== 0) return benchDiff;
    const minutesDiff = minutes[a.id] - minutes[b.id];
    if (minutesDiff !== 0) return minutesDiff;
    return Math.random() - 0.5;
  });

  const starters = g <= 0 ? [...presentPlayers] : ranked.slice(0, P);
  const benchedSet = new Set(g <= 0 ? [] : ranked.slice(P).map((p) => p.id));

  // ---- Assign starting positions ----
  // Striker is handed out first and explicitly, since it's the shirt everyone
  // wants; the rest go to whoever has played them least today.
  const onFieldAssignment = {};
  const available = [...requiredPositions];

  const strikerIdx = available.findIndex(isStriker);
  if (strikerIdx !== -1) {
    const strikerPos = available[strikerIdx];
    const forStriker = [...starters].sort((a, b) => {
      const stDiff = strikerStarts[a.id] - strikerStarts[b.id];
      if (stDiff !== 0) return stDiff;
      const played = (positionCount[a.id][strikerPos] || 0) - (positionCount[b.id][strikerPos] || 0);
      if (played !== 0) return played;
      return Math.random() - 0.5;
    })[0];
    onFieldAssignment[forStriker.id] = strikerPos;
    available.splice(strikerIdx, 1);
  }

  const leastPlayedPosition = (playerId, positions) =>
    [...positions].sort((a, b) => {
      const ca = positionCount[playerId][a] || 0;
      const cb = positionCount[playerId][b] || 0;
      if (ca !== cb) return ca - cb;
      return Math.random() - 0.5;
    })[0];

  starters.forEach((p) => {
    if (onFieldAssignment[p.id]) return; // already given the striker shirt
    if (p.preferredPosition && available.includes(p.preferredPosition)) {
      onFieldAssignment[p.id] = p.preferredPosition;
      available.splice(available.indexOf(p.preferredPosition), 1);
      return;
    }
    const pos = leastPlayedPosition(p.id, available);
    onFieldAssignment[p.id] = pos;
    available.splice(available.indexOf(pos), 1);
  });

  // ---- Walk the blocks, substituting on the way ----
  const intervals = [];
  const benchedBlocks = {}; // how many blocks each player has sat out this game
  presentPlayers.forEach((p) => { benchedBlocks[p.id] = 0; });

  for (let i = 0; i < blocks; i++) {
    const startMin = Math.round(i * blockLength * 1000) / 1000;
    const endMin = Math.round(Math.min(duration, (i + 1) * blockLength) * 1000) / 1000;
    const intervalMins = endMin - startMin;

    if (i > 0 && g > 0) {
      // Bring off whoever has sat out least this game (and most minutes overall);
      // bring on whoever has sat out most. Anyone not in either group is left
      // completely untouched, so they keep their position rather than being
      // shuffled around mid-game.
      const onFieldIds = Object.keys(onFieldAssignment);
      const comingOff = [...onFieldIds]
        .sort((a, b) => {
          const benchDiff = benchedBlocks[a] - benchedBlocks[b];
          if (benchDiff !== 0) return benchDiff;
          const minsDiff = minutes[b] - minutes[a];
          if (minsDiff !== 0) return minsDiff;
          return Math.random() - 0.5;
        })
        .slice(0, g);

      const comingOn = [...benchedSet]
        .sort((a, b) => {
          const benchDiff = benchedBlocks[b] - benchedBlocks[a];
          if (benchDiff !== 0) return benchDiff;
          const minsDiff = minutes[a] - minutes[b];
          if (minsDiff !== 0) return minsDiff;
          return Math.random() - 0.5;
        })
        .slice(0, g);

      const vacated = comingOff.map((id) => onFieldAssignment[id]);
      comingOff.forEach((id) => {
        delete onFieldAssignment[id];
        benchedSet.add(id);
      });

      [...comingOn].sort(() => Math.random() - 0.5).forEach((playerId) => {
        vacated.sort((a, b) => {
          const ca = positionCount[playerId][a] || 0;
          const cb = positionCount[playerId][b] || 0;
          return ca - cb;
        });
        onFieldAssignment[playerId] = vacated.shift();
        benchedSet.delete(playerId);
      });
    }

    const onField = Object.entries(onFieldAssignment).map(([playerId, position]) => ({ playerId, position }));
    const benched = [...benchedSet];

    onField.forEach(({ playerId, position }) => {
      minutes[playerId] += intervalMins;
      positionCount[playerId][position] = (positionCount[playerId][position] || 0) + 1;
    });
    benched.forEach((id) => { benchedBlocks[id] += 1; });

    intervals.push({ index: i, startMin, endMin, onField, benched });
  }

  return { intervals };
}

// Per-player totals for a whole match day, so fairness can be eyeballed rather
// than taken on trust.
function computeMatchdayFairness(matchday, roster) {
  const stats = {};
  (matchday.presentPlayerIds || []).forEach((id) => {
    stats[id] = { name: roster.find((r) => r.id === id)?.name || "?", minutes: 0, benchStarts: 0, strikerStarts: 0, positions: {} };
  });
  (matchday.games || []).forEach((game) => {
    (game.intervals || []).forEach((iv, ivIdx) => {
      const mins = (iv.endMin ?? 0) - (iv.startMin ?? 0);
      (iv.onField || []).forEach((of) => {
        if (!stats[of.playerId]) return;
        stats[of.playerId].minutes += mins;
        stats[of.playerId].positions[of.position] = (stats[of.playerId].positions[of.position] || 0) + 1;
        if (ivIdx === 0 && (of.position === "ST" || of.position === "CF")) stats[of.playerId].strikerStarts += 1;
      });
      if (ivIdx === 0) {
        (iv.benched || []).forEach((id) => { if (stats[id]) stats[id].benchStarts += 1; });
      }
    });
  });
  return stats;
}

// --- MATCHDAY CARD COMPONENT ---
function MatchDayCard({ matchday, roster, formats, onUpdateMatchday, onDelete, flash, COLORS = DEFAULT_THEME.colors }) {
  const gameRefs = React.useRef({});
  const allGamesRef = React.useRef(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [showFairness, setShowFairness] = useState(false);
  const [numGamesToAdd, setNumGamesToAdd] = useState(1);
  const [selectedFormatId, setSelectedFormatId] = useState(formats[0]?.id || '');
  const [opponent, setOpponent] = useState('');
  const [gameDuration, setGameDuration] = useState(10);
  const [numBlocks, setNumBlocks] = useState(3);
  const [isMatchdayCollapsed, setIsMatchdayCollapsed] = useState(() => {
    const games = matchday.games || [];
    return games.length > 0 && games.every((g) => g.played);
  });
  const [collapsedGames, setCollapsedGames] = useState({});

  const presentPlayers = roster.filter((p) => (matchday.presentPlayerIds || []).includes(p.id));
  const fairness = useMemo(() => computeMatchdayFairness(matchday, roster), [matchday, roster]);
  const isPastEvent = matchday.date < todayStr();

  // Default the number of rotation blocks to whatever divides the squad evenly
  // for the selected format (6 players in a 4v4 -> 3 blocks, so everyone sits
  // exactly once; 5 players -> 5 blocks).
  useEffect(() => {
    const fmt = formats.find((f) => f.id === selectedFormatId) || formats[0];
    if (!fmt || !presentPlayers.length) return;
    setNumBlocks(suggestedBlocks(presentPlayers.length, fmt.positions.length));
  }, [presentPlayers.length, selectedFormatId, formats]);

  useEffect(() => {
    if (!selectedFormatId && formats.length > 0) {
      setSelectedFormatId(formats[0].id);
    }
  }, [formats, selectedFormatId]);

  // Past events are automatically treated as complete — catches events created
  // (or whose games were added) before today, without needing a manual click.
  useEffect(() => {
    if (isPastEvent && (matchday.games || []).some((g) => !g.played)) {
      onUpdateMatchday({
        ...matchday,
        games: matchday.games.map((g) => ({ ...g, played: true })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchday]);

  const [swapPick, setSwapPick] = useState(null); // { gameId, intervalIndex, playerId }

  const swapPlayersInInterval = (game, intervalIndex, idA, idB) => {
    const interval = game.intervals[intervalIndex];
    const onFieldA = interval.onField.find((o) => o.playerId === idA);
    const onFieldB = interval.onField.find((o) => o.playerId === idB);

    if (!onFieldA && !onFieldB) {
      flash("Pick at least one player who's on the pitch to swap");
      return game;
    }

    let nextOnField = [...interval.onField];
    let nextBenched = [...interval.benched];

    if (onFieldA && onFieldB) {
      // Both on the pitch — just swap their positions.
      nextOnField = nextOnField.map((o) => {
        if (o.playerId === idA) return { ...o, position: onFieldB.position };
        if (o.playerId === idB) return { ...o, position: onFieldA.position };
        return o;
      });
    } else {
      // One on the pitch, one on the bench — the bench player takes the
      // pitch player's spot and vice versa.
      const onPitchId = onFieldA ? idA : idB;
      const onBenchId = onFieldA ? idB : idA;
      const vacatedPosition = (onFieldA || onFieldB).position;
      nextOnField = nextOnField
        .filter((o) => o.playerId !== onPitchId)
        .concat([{ playerId: onBenchId, position: vacatedPosition }]);
      nextBenched = nextBenched.filter((id) => id !== onBenchId).concat([onPitchId]);
    }

    const nextIntervals = game.intervals.map((iv, idx) =>
      idx === intervalIndex ? { ...iv, onField: nextOnField, benched: nextBenched } : iv
    );
    return { ...game, intervals: nextIntervals };
  };

  const handlePlayerClick = (gameId, intervalIndex, playerId) => {
    if (!swapPick || swapPick.gameId !== gameId || swapPick.intervalIndex !== intervalIndex) {
      setSwapPick({ gameId, intervalIndex, playerId });
      return;
    }
    if (swapPick.playerId === playerId) {
      setSwapPick(null);
      return;
    }
    const game = matchday.games.find((g) => g.id === gameId);
    const updatedGame = swapPlayersInInterval(game, intervalIndex, swapPick.playerId, playerId);
    onUpdateMatchday({ ...matchday, games: matchday.games.map((g) => (g.id === gameId ? updatedGame : g)) });
    setSwapPick(null);
  };

  const shareAllGames = async () => {
    // Temporarily expand every game (any that were individually collapsed)
    // so the exported image shows every schedule, then restore how they were.
    const prevCollapsed = collapsedGames;
    setCollapsedGames({});
    setExportingAll(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await exportElementAsImage(allGamesRef.current, `matchday-${matchday.date}-all-games.png`, flash);
    setCollapsedGames(prevCollapsed);
    setExportingAll(false);
  };

  const addGames = () => {
    const fmt = formats.find((f) => f.id === selectedFormatId) || formats[0];
    if (!fmt) {
      alert("Please define at least one format under Match Day > Formats.");
      return;
    }

    const newGames = [];

    for (let i = 0; i < numGamesToAdd; i++) {
      const plan = generateRotationPlan(
        presentPlayers,
        fmt.positions,
        Number(gameDuration),
        Number(numBlocks),
        [...(matchday.games || []), ...newGames]
      );

      if (!plan) {
        alert(`Need at least ${fmt.positions.length} present players for ${fmt.name} (${fmt.positions.length}v${fmt.positions.length}).`);
        return;
      }

      newGames.push({
        id: `g_${Date.now()}_${i}`,
        formatId: fmt.id,
        formatName: fmt.name,
        positions: fmt.positions,
        duration: Number(gameDuration),
        numBlocks: Number(numBlocks),
        opponent: opponent.trim(),
        played: isPastEvent,
        intervals: plan.intervals
      });
    }

    onUpdateMatchday({
      ...matchday,
      games: [...(matchday.games || []), ...newGames]
    });
  };

  const togglePlayed = (gameId) => {
    const updatedGames = (matchday.games || []).map((g) =>
      g.id === gameId ? { ...g, played: !g.played } : g
    );
    onUpdateMatchday({ ...matchday, games: updatedGames });
  };

  const markAllComplete = () => {
    const updatedGames = (matchday.games || []).map((g) => ({ ...g, played: true }));
    onUpdateMatchday({ ...matchday, games: updatedGames });
  };

  const toggleGameCollapse = (gameId) => {
    setCollapsedGames((prev) => ({ ...prev, [gameId]: !prev[gameId] }));
  };

  const regenerateGame = (gameId) => {
    const game = matchday.games.find((g) => g.id === gameId);
    if (!game) return;

    const fmt = formats.find((f) => f.id === game.formatId) || { positions: game.positions };
    const plan = generateRotationPlan(
      presentPlayers,
      fmt.positions || game.positions,
      game.duration,
      game.numBlocks || Math.max(1, Math.round(game.duration / (game.subInterval || 2))),
      matchday.games.filter((g) => g.id !== gameId)
    );

    if (!plan) return;

    const updatedGames = matchday.games.map((g) => (g.id === gameId ? { ...g, intervals: plan.intervals } : g));
    onUpdateMatchday({ ...matchday, games: updatedGames });
  };

  return (
    <Card className="p-4 sm:p-5 mb-5">
      <button
        onClick={() => setIsMatchdayCollapsed(!isMatchdayCollapsed)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          {isMatchdayCollapsed ? <ChevronRight size={18} color={COLORS.inkSoft} /> : <ChevronDown size={18} color={COLORS.inkSoft} />}
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-xl">
            MATCH DAY — {matchday.date}
          </div>
          {isPastEvent && <Pill tone="chalk" COLORS={COLORS}>Past</Pill>}
        </div>
        <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
          {presentPlayers.length} present · {(matchday.games || []).length} game{(matchday.games || []).length === 1 ? "" : "s"}
        </span>
      </button>

      {!isMatchdayCollapsed && (
        <div className="mt-4 space-y-4">
          <div>
            <Label COLORS={COLORS}>Playing today</Label>
            <div className="flex flex-wrap gap-1.5">
              {presentPlayers.map((p) => (
                <Pill key={p.id} tone="chalk" COLORS={COLORS}>{p.name}</Pill>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-3" style={{ borderColor: "#E4DFD0" }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: COLORS.inkSoft }}>Add Games</div>
            <div className="grid sm:grid-cols-4 gap-2 mb-2">
              <div>
                <Label COLORS={COLORS}>Format</Label>
                <Select
                  value={selectedFormatId}
                  onChange={setSelectedFormatId}
                  options={formats.map((f) => ({ value: f.id, label: `${f.positions.length}v${f.positions.length} · ${f.name}` }))}
                  COLORS={COLORS}
                />
              </div>
              <div>
                <Label COLORS={COLORS}>Opponent (optional)</Label>
                <TextInput placeholder="e.g. Riverside FC" value={opponent} onChange={(e) => setOpponent(e.target.value)} COLORS={COLORS} />
              </div>
              <div>
                <Label COLORS={COLORS}>Duration (mins)</Label>
                <TextInput type="number" value={gameDuration} onChange={(e) => setGameDuration(e.target.value)} COLORS={COLORS} />
              </div>
              <div>
                <Label COLORS={COLORS}>Rotation blocks</Label>
                <TextInput type="number" min="1" value={numBlocks} onChange={(e) => setNumBlocks(e.target.value)} COLORS={COLORS} />
                <p className="text-[11px] mt-1" style={{ color: COLORS.inkSoft }}>
                  {Number(numBlocks) > 0 ? `${fmtTime(Number(gameDuration) / Number(numBlocks))} each` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="w-24">
                <Label COLORS={COLORS}>Games</Label>
                <TextInput type="number" min="1" value={numGamesToAdd} onChange={(e) => setNumGamesToAdd(e.target.value)} COLORS={COLORS} />
              </div>
              <Button variant="primary" icon={Shuffle} onClick={addGames} COLORS={COLORS}>Generate Games</Button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>
                Schedule ({(matchday.games || []).length} games)
              </div>
              {(matchday.games || []).length > 0 && (
                <Button variant="ghost" size="sm" icon={Share2} onClick={shareAllGames} disabled={exportingAll} COLORS={COLORS}>
                  {exportingAll ? "Preparing…" : "Share Match Day"}
                </Button>
              )}
            </div>
            <div className="space-y-2" ref={allGamesRef}>
              {(matchday.games || []).map((game, gIdx) => {
                const isCollapsed = collapsedGames[game.id];
                return (
                  <div
                    key={game.id}
                    ref={(el) => { gameRefs.current[game.id] = el; }}
                    className="rounded-lg border overflow-hidden"
                    style={{ borderColor: "#E4DFD0" }}
                  >
                    <button
                      onClick={() => toggleGameCollapse(game.id)}
                      className="w-full flex items-center justify-between p-3 text-left"
                      style={{ background: game.played ? "#EAF5EC" : "#fff" }}
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight size={15} color={COLORS.inkSoft} /> : <ChevronDown size={15} color={COLORS.inkSoft} />}
                        <span className="text-sm font-bold" style={{ color: COLORS.ink }}>
                          Game {gIdx + 1}{game.opponent ? ` vs ${game.opponent}` : ""}
                        </span>
                        <span className="text-xs" style={{ color: COLORS.inkSoft }}>
                          {game.positions?.length}v{game.positions?.length} · {game.formatName} · {game.duration} mins
                        </span>
                      </div>
                      {game.played ? <Pill tone="pitch" COLORS={COLORS}>Played</Pill> : <Pill tone="amber" COLORS={COLORS}>Planned</Pill>}
                    </button>

                    {!isCollapsed && (
                      <div className="p-3 pt-0">
                        <p className="text-[11px] mb-1.5" style={{ color: COLORS.inkSoft }}>
                          Tap a player, then tap another in the same row to swap them (works between pitch and bench too).
                        </p>
                        <div className="space-y-1.5 mb-3">
                          {game.intervals.map((iv, intervalIndex) => (
                            <div key={iv.index} className="text-xs rounded-md px-2 py-1.5" style={{ background: COLORS.chalkDim }}>
                              <span className="font-mono font-semibold" style={{ color: COLORS.inkSoft, fontFamily: "JetBrains Mono" }}>
                                {fmtTime(iv.startMin)}–{fmtTime(iv.endMin)}
                              </span>
                              <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                                {iv.onField.map((of) => {
                                  const p = roster.find((r) => r.id === of.playerId);
                                  const isPicked = swapPick && swapPick.gameId === game.id && swapPick.intervalIndex === intervalIndex && swapPick.playerId === of.playerId;
                                  return (
                                    <button
                                      key={of.playerId}
                                      onClick={() => handlePlayerClick(game.id, intervalIndex, of.playerId)}
                                      className="px-1.5 py-0.5 rounded font-semibold"
                                      style={{
                                        background: isPicked ? COLORS.amber : "transparent",
                                        color: COLORS.ink,
                                        border: isPicked ? `1px solid ${COLORS.amber}` : "1px solid transparent",
                                      }}
                                    >
                                      {p?.name || "?"} ({of.position})
                                    </button>
                                  );
                                })}
                              </span>
                              {iv.benched.length > 0 && (
                                <span className="ml-2 italic inline-flex flex-wrap gap-1 align-middle">
                                  — bench:
                                  {iv.benched.map((bId) => {
                                    const p = roster.find((r) => r.id === bId);
                                    const isPicked = swapPick && swapPick.gameId === game.id && swapPick.intervalIndex === intervalIndex && swapPick.playerId === bId;
                                    return (
                                      <button
                                        key={bId}
                                        onClick={() => handlePlayerClick(game.id, intervalIndex, bId)}
                                        className="px-1.5 py-0.5 rounded"
                                        style={{
                                          background: isPicked ? COLORS.amber : "transparent",
                                          color: COLORS.inkSoft,
                                          border: isPicked ? `1px solid ${COLORS.amber}` : "1px solid transparent",
                                        }}
                                      >
                                        {p?.name || "?"}
                                      </button>
                                    );
                                  })}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            variant={game.played ? "subtle" : "dark"}
                            size="sm"
                            icon={CheckCircle2}
                            onClick={() => togglePlayed(game.id)}
                            COLORS={COLORS}
                          >
                            {game.played ? "Mark not played" : "Mark played"}
                          </Button>
                          <Button variant="ghost" size="sm" icon={Repeat} onClick={() => regenerateGame(game.id)} COLORS={COLORS}>
                            Reshuffle
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Share2}
                            onClick={() => exportElementAsImage(
                              gameRefs.current[game.id],
                              `matchday-${matchday.date}-game${gIdx + 1}.png`,
                              flash
                            )}
                            COLORS={COLORS}
                          >
                            Share Image
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {(matchday.games || []).length === 0 && (
                <p className="text-xs text-center py-3" style={{ color: COLORS.inkSoft }}>No games added to this match day yet.</p>
              )}
            </div>
          </div>

          {(matchday.games || []).length > 0 && (
            <div className="rounded-lg border p-3" style={{ borderColor: "#E4DFD0" }}>
              <button
                onClick={() => setShowFairness(!showFairness)}
                className="w-full flex items-center justify-between"
              >
                <div className="text-xs font-bold uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>
                  Fairness Check
                </div>
                {showFairness ? <ChevronDown size={14} color={COLORS.inkSoft} /> : <ChevronRight size={14} color={COLORS.inkSoft} />}
              </button>
              {showFairness && (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs" style={{ color: COLORS.ink }}>
                  <thead>
                    <tr style={{ color: COLORS.inkSoft }}>
                      <th className="text-left font-bold py-1 pr-3">Player</th>
                      <th className="text-right font-bold py-1 px-2">Mins</th>
                      <th className="text-right font-bold py-1 px-2">Bench starts</th>
                      <th className="text-right font-bold py-1 px-2">ST starts</th>
                      <th className="text-left font-bold py-1 pl-2">Positions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(fairness)
                      .sort((a, b) => a[1].name.localeCompare(b[1].name))
                      .map(([pid, st]) => (
                        <tr key={pid} style={{ borderTop: "1px solid #EDE9DE" }}>
                          <td className="py-1 pr-3 font-semibold">{st.name}</td>
                          <td className="py-1 px-2 text-right font-mono" style={{ fontFamily: "JetBrains Mono" }}>{fmtTime(st.minutes)}</td>
                          <td className="py-1 px-2 text-right font-mono" style={{ fontFamily: "JetBrains Mono" }}>{st.benchStarts}</td>
                          <td className="py-1 px-2 text-right font-mono" style={{ fontFamily: "JetBrains Mono" }}>{st.strikerStarts}</td>
                          <td className="py-1 pl-2" style={{ color: COLORS.inkSoft }}>
                            {Object.entries(st.positions).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="ghost" size="sm" icon={CheckCircle2} onClick={markAllComplete} COLORS={COLORS}>
              Mark all complete
            </Button>
            <Button variant="danger" size="sm" icon={Trash2} onClick={onDelete} COLORS={COLORS}>
              Delete match day
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}


const BASE_THEMES = [
  {
    id: "pitch",
    name: "Classic Pitch",
    colors: {
      pitch: "#1F4B3F",
      pitchLight: "#2D6A4F",
      pitchLighter: "#3B8362",
      chalk: "#F7F5EF",
      chalkDim: "#EDE9DE",
      amber: "#E8A33D",
      amberDeep: "#C97F1E",
      ink: "#16232B",
      inkSoft: "#4B5C58",
      danger: "#C0433A",
      line: "#FFFFFF",
    },
  },
  {
    id: "midnight",
    name: "Midnight Tactical",
    colors: {
      pitch: "#0F172A",
      pitchLight: "#1E293B",
      pitchLighter: "#334155",
      chalk: "#F1F5F9",
      chalkDim: "#E2E8F0",
      amber: "#38BDF8",
      amberDeep: "#0284C7",
      ink: "#0F172A",
      inkSoft: "#475569",
      danger: "#EF4444",
      line: "#FFFFFF",
    },
  },
];

const DEFAULT_THEME = BASE_THEMES[0];

// Native crypto.randomUUID() for valid PostgreSQL UUIDs
const uid = () => crypto.randomUUID();
const todayStr = () => new Date().toISOString().slice(0, 10);

const DEFAULT_THEMES = ["Shooting", "Passing", "Dribbling", "Defending"];
const FULL_GAME = "Full Game";
const CONDITIONAL_GAME = "Conditional Game";
const THEME_MARKER = "Theme"; 

const DEFAULT_CATEGORIES = [
  "Warm-up", "Shooting", "Passing", "Defending", "Dribbling", CONDITIONAL_GAME, FULL_GAME,
];

const DEFAULT_DRILLS = [
  { name: "Red Light Green Light", category: "Warm-up", theme: "", description: "Sprint on green, freeze on red — reaction and listening." },
  { name: "Simon Says", category: "Warm-up", theme: "", description: "Classic listening game to sharpen focus before training." },
  { name: "Obstacle Course", category: "Warm-up", theme: "", description: "Cones, hurdles and gates to move through — coordination warm-up." },
  { name: "High Knees Laps", category: "Warm-up", theme: "", description: "Laps of the area with high knees to raise heart rate." },
  { name: "Animal Walks", category: "Warm-up", theme: "", description: "Bear crawl, crab walk, frog jumps, bunny hops across the area." },
  { name: "Shadow Tag", category: "Warm-up", theme: "", description: "Pairs — one copies every movement of the leader, no ball." },
  { name: "Cone Colour Switch", category: "Warm-up", theme: "", description: "Jog freely, shout a colour, touch that cone fastest." },
  { name: "Follow the Ball", category: "Warm-up", theme: "", description: "Coach rolls/bounces a ball, players track and shuffle to face it." },
  { name: "Statues", category: "Warm-up", theme: "", description: "Move on command, freeze on 'statue' — wobblers sit out briefly." },
  { name: "Bulldog", category: "Warm-up", theme: "", description: "Taggers in the middle, everyone else runs across to the other side." },
  { name: "Countdown Sprints", category: "Warm-up", theme: "", description: "A few reps of an exercise, then a short sprint on 'GO!'." },
  { name: "Numbers/Colour Callouts", category: "Warm-up", theme: "", description: "Call a number or colour, players perform the matching skill." },
  { name: "Traffic Light Shooting", category: "Shooting", theme: "", description: "Three coloured mini-goals — shout a colour, shoot into that one." },
  { name: "Number Targets", category: "Shooting", theme: "", description: "Numbered cones inside the goal — call a number to aim for." },
  { name: "Pass and Follow the Leader", category: "Passing", theme: "", description: "Pairs pass while snaking through cones, passer becomes new leader." },
  { name: "Clock Passing", category: "Passing", theme: "", description: "Circle of players as clock positions, middle player calls a number to pass to." },
  { name: "Shadow Defending", category: "Defending", theme: "", description: "Pairs — defender mirrors attacker's movement staying goal-side, no ball." },
  { name: "Guard the Cones", category: "Defending", theme: "", description: "Defender protects two cones from an attacker trying to touch them." },
  { name: "Freeze Dribble", category: "Dribbling", theme: "", description: "Dribble freely, freeze with foot on ball on command — last to freeze does star jumps." },
  { name: "3-Pass Goal", category: CONDITIONAL_GAME, theme: "Passing", description: "A goal only counts after 3 completed passes." },
  { name: "Shot Clock Game", category: CONDITIONAL_GAME, theme: "Shooting", description: "Must shoot within 5 touches of winning the ball." },
  { name: "1v1 to End Zone", category: CONDITIONAL_GAME, theme: "Dribbling", description: "Dribble past your defender into an end zone to score." },
  { name: "Interception Game", category: CONDITIONAL_GAME, theme: "Defending", description: "A point for every interception or clean tackle, on top of goals." },
  { name: "Colour Cone Dribble", category: "Dribbling", theme: "", description: "Dribble to touch the called colour cone fastest." },
];

const DEFAULT_METHODS = [
  {
    name: "Traditional",
    phases: [
      { label: "Warm-up", defaultCategory: "Warm-up" },
      { label: "Skill Related", defaultCategory: THEME_MARKER },
      { label: "Conditional Game", defaultCategory: CONDITIONAL_GAME },
      { label: "Full Game", defaultCategory: FULL_GAME },
    ],
  },
  {
    name: "Whole-Part-Whole",
    phases: [
      { label: "Full Game", defaultCategory: FULL_GAME },
      { label: "Skill", defaultCategory: THEME_MARKER },
      { label: "Conditional Game", defaultCategory: CONDITIONAL_GAME },
    ],
  },
];

const POSITION_LIBRARY = [
  { code: "GK", label: "Goalkeeper", line: "GK" },
  { code: "DEF", label: "Defender", line: "DEF" },
  { code: "CB", label: "Centre Back", line: "DEF" },
  { code: "LB", label: "Left Back", line: "DEF" },
  { code: "RB", label: "Right Back", line: "DEF" },
  { code: "LWB", label: "Left Wing Back", line: "DEF" },
  { code: "RWB", label: "Right Wing Back", line: "DEF" },
  { code: "CDM", label: "Defensive Mid", line: "MID" },
  { code: "CM", label: "Centre Mid", line: "MID" },
  { code: "LM", label: "Left Mid", line: "MID" },
  { code: "RM", label: "Right Mid", line: "MID" },
  { code: "CAM", label: "Attacking Mid", line: "MID" },
  { code: "LW", label: "Left Wing", line: "MID" },
  { code: "RW", label: "Right Wing", line: "MID" },
  { code: "ST", label: "Striker", line: "ATT" },
  { code: "CF", label: "Centre Forward", line: "ATT" },
];
const POSITION_LINE = Object.fromEntries(POSITION_LIBRARY.map((p) => [p.code, p.line]));

function formationShapeName(positions) {
  let def = 0, mid = 0, att = 0;
  positions.forEach((code) => {
    const line = POSITION_LINE[code];
    if (line === "DEF") def++;
    else if (line === "MID") mid++;
    else if (line === "ATT") att++;
  });
  return `${def}-${mid}-${att}`;
}

const SQUAD_TEAM = "Squad";

const TEAM_PALETTE = [
  "#3B82F6", "#8B5CF6", "#EC4899", "#F97316", "#14B8A6",
  "#6366F1", "#65A30D", "#0EA5E9", "#D946EF", "#F43F5E",
];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function getTeamColor(team) {
  if (team === SQUAD_TEAM) return "#6B7280";
  return TEAM_PALETTE[hashStr(team) % TEAM_PALETTE.length];
}
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const DEFAULT_FORMATS = [
  { positions: ["GK", "DEF", "MID", "ST"] },
  { positions: ["GK", "LB", "RB", "CM", "LM", "RM", "ST"] }
];

const DEFAULT_TEAMS = [SQUAD_TEAM];

function normalizeTeams(list) {
  const t = (list || []).map((x) => (x === "Unassigned" ? SQUAD_TEAM : x));
  return t.includes(SQUAD_TEAM) ? t : [SQUAD_TEAM, ...t];
}

function normalizePlayers(list) {
  return (list || []).map((p) => {
    if (Array.isArray(p.teams)) return p;
    const legacy = p.team && p.team !== "Unassigned" ? p.team : SQUAD_TEAM;
    const { team, ...rest } = p;
    return { ...rest, teams: [legacy] };
  });
}

function seedData() {
  const drills = DEFAULT_DRILLS.map((d) => ({ id: uid(), timesUsed: 0, ...d }));
  const methods = DEFAULT_METHODS.map((m) => ({
    id: uid(),
    name: m.name,
    phases: m.phases.map((p) => ({ id: uid(), ...p })),
  }));
  const formats = DEFAULT_FORMATS.map((f) => ({ id: uid(), name: formationShapeName(f.positions), ...f }));
  return {
    drills, methods, categories: DEFAULT_CATEGORIES, sessionThemes: DEFAULT_THEMES, sessions: [], ratings: [],
    players: [], teams: DEFAULT_TEAMS, formats, matchdays: [],
  };
}

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

// SUPABASE DATA LAYER
const FIELD_MAP = {
  drills: { timesUsed: "times_used" },
  sessions: { methodId: "method_id", methodName: "method_name" },
  ratings: { sessionId: "session_id", drillId: "drill_id" },
  players: { gamesPlayed: "games_played", positionCounts: "position_counts", rotationPointer: "rotation_pointer" },
  matchdays: { teamFilter: "team_filter", presentPlayerIds: "present_player_ids" },
  theme_presets: { themeData: "theme_data" },
  calendar_settings: { trainingDays: "training_days", playingDays: "playing_days" }
};
const ROW_TABLES = ["drills", "methods", "sessions", "ratings", "players", "formats", "matchdays", "theme_presets", "calendar_settings"];
const NAME_TABLES = ["categories", "teams", "session_themes"];
const DEFAULT_CALENDAR_SETTINGS = { id: "default", trainingDays: [], playingDays: [], holidays: [], tabOrder: [] };

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function toRow(table, obj) {
  const map = FIELD_MAP[table] || {};
  const row = {};
  Object.entries(obj).forEach(([k, v]) => {
    row[map[k] || camelToSnake(k)] = v;
  });
  return row;
}
function fromRow(table, row) {
  const map = FIELD_MAP[table] || {};
  const reverse = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  const obj = {};
  Object.entries(row).forEach(([col, v]) => {
    if (col === "created_at") return;
    obj[reverse[col] || snakeToCamel(col)] = v;
  });
  return obj;
}

async function fetchTable(table) {
  if (NAME_TABLES.includes(table)) {
    const { data, error } = await withTimeout(supabase.from(table).select("name"), 8000) || {};
    if (error || !data) return null;
    return data.map((r) => r.name);
  }
  const { data, error } = await withTimeout(supabase.from(table).select("*"), 8000) || {};
  if (error || !data) return null;
  return data.map((r) => fromRow(table, r));
}

async function seedTable(table, rows) {
  if (NAME_TABLES.includes(table)) {
    if (!rows.length) return;
    const { error } = await supabase.from(table).upsert(rows.map((name) => ({ name })));
    if (error) console.error(`seedTable(${table}) failed:`, error.message);
    return;
  }
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows.map((r) => toRow(table, r)));
  if (error) console.error(`seedTable(${table}) failed:`, error.message);
}

async function syncRowTable(table, prevList, nextList) {
  const prevIds = new Set(prevList.map((x) => x.id));
  const nextIds = new Set(nextList.map((x) => x.id));
  const toDelete = prevList.filter((x) => !nextIds.has(x.id)).map((x) => x.id);
  if (toDelete.length) {
    const { error } = await supabase.from(table).delete().in("id", toDelete);
    if (error) console.error(`syncRowTable(${table}) delete failed:`, error.message);
  }
  if (nextList.length) {
    const { error } = await supabase.from(table).upsert(nextList.map((r) => toRow(table, r)));
    if (error) console.error(`syncRowTable(${table}) upsert failed:`, error.message);
  }
}
async function syncNameTable(table, prevList, nextList) {
  const nextSet = new Set(nextList);
  const toDelete = prevList.filter((x) => !nextSet.has(x));
  if (toDelete.length) {
    const { error } = await supabase.from(table).delete().in("name", toDelete);
    if (error) console.error(`syncNameTable(${table}) delete failed:`, error.message);
  }
  if (nextList.length) {
    const { error } = await supabase.from(table).upsert(nextList.map((name) => ({ name })));
    if (error) console.error(`syncNameTable(${table}) upsert failed:`, error.message);
  }
}

function useRefValue(value) {
  const ref = React.useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

function Pill({ children, tone = "pitch", COLORS = DEFAULT_THEME.colors }) {
  const map = {
    pitch: { bg: COLORS.pitchLight, fg: "#fff" },
    amber: { bg: COLORS.amber, fg: COLORS.ink },
    chalk: { bg: COLORS.chalkDim, fg: COLORS.ink },
  };
  const c = map[tone];
  return (
    <span
      style={{ background: c.bg, color: c.fg, fontFamily: "Inter" }}
      className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
    >
      {children}
    </span>
  );
}

function StarRating({ value, onChange, size = 16, readOnly = false, COLORS = DEFAULT_THEME.colors }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            onMouseEnter={() => !readOnly && setHover(n)}
            onMouseLeave={() => !readOnly && setHover(0)}
            onClick={() => !readOnly && onChange && onChange(n)}
            className={readOnly ? "cursor-default" : "cursor-pointer"}
          >
            <Star
              size={size}
              fill={filled ? COLORS.amber : "none"}
              color={filled ? COLORS.amber : COLORS.inkSoft}
              strokeWidth={1.75}
            />
          </button>
        );
      })}
    </div>
  );
}

function Card({ children, className = "", style = {} }) {
  return (
    <div
      className={`rounded-xl border ${className}`}
      style={{ background: "#fff", borderColor: "#E4DFD0", ...style }}
    >
      {children}
    </div>
  );
}

function Button({ children, onClick, variant = "primary", size = "md", icon: Icon, disabled, type = "button", title, COLORS = DEFAULT_THEME.colors }) {
  const base = "inline-flex items-center gap-1.5 font-semibold transition-transform active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none rounded-lg";
  const sizes = { sm: "text-xs px-2.5 py-1.5", md: "text-sm px-3.5 py-2", lg: "text-base px-5 py-2.5" };
  const variants = {
    primary: { background: COLORS.amber, color: COLORS.ink },
    dark: { background: COLORS.pitch, color: "#fff" },
    ghost: { background: "transparent", color: COLORS.pitch, border: `1.5px solid ${COLORS.pitch}` },
    danger: { background: "transparent", color: COLORS.danger, border: `1.5px solid ${COLORS.danger}` },
    subtle: { background: COLORS.chalkDim, color: COLORS.ink },
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]}`}
      style={{ fontFamily: "Inter", ...variants[variant] }}
    >
      {Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

function Select({ value, onChange, options, placeholder, COLORS = DEFAULT_THEME.colors }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm rounded-lg px-2.5 py-2 border outline-none"
      style={{ fontFamily: "Inter", borderColor: "#D9D3C1", color: COLORS.ink, background: "#fff" }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function TextInput(props) {
  const COLORS = props.COLORS || DEFAULT_THEME.colors;
  return (
    <input
      {...props}
      className={`w-full text-sm rounded-lg px-2.5 py-2 border outline-none ${props.className || ""}`}
      style={{ fontFamily: "Inter", borderColor: "#D9D3C1", color: COLORS.ink, ...(props.style || {}) }}
    />
  );
}

function Label({ children, COLORS = DEFAULT_THEME.colors }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: COLORS.inkSoft, fontFamily: "Inter" }}>
      {children}
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [drills, setDrills] = useState([]);
  const [methods, setMethods] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sessionThemes, setSessionThemes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [formats, setFormats] = useState([]);
  const [matchdays, setMatchdays] = useState([]);
  const [calendarSettingsRows, setCalendarSettingsRows] = useState([]);
  const [calendarTableMissing, setCalendarTableMissing] = useState(false);
  
  // Theme state
  const [customThemes, setCustomThemes] = useState(BASE_THEMES);
  const [activeThemeId, setActiveThemeId] = useState("pitch");
  const [showThemeModal, setShowThemeModal] = useState(false);

  const [tab, setTab] = useState("plan");
  const [toast, setToast] = useState(null);
  const [connectionWarning, setConnectionWarning] = useState(false);

  const activeTheme = customThemes.find((t) => t.id === activeThemeId) || BASE_THEMES[0];
  const COLORS = activeTheme.colors;

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), msg && msg.length > 60 ? 5000 : 2200);
  };

  useEffect(() => {
    (async () => {
      const [d, m, c, st, s, r, pl, tm, fm, md, tp, cs] = await Promise.all([
        fetchTable("drills"), fetchTable("methods"), fetchTable("categories"),
        fetchTable("session_themes"), fetchTable("sessions"), fetchTable("ratings"), 
        fetchTable("players"), fetchTable("teams"), fetchTable("formats"), 
        fetchTable("matchdays"), fetchTable("theme_presets"), fetchTable("calendar_settings")
      ]);

      if ([d, m, c, s, r, pl, tm, fm, md].some((x) => x === null)) {
        setConnectionWarning(true);
        setLoading(false);
        return;
      }

      let finalDrills = d, finalMethods = m, finalCategories = c, finalThemes = st, finalFormats = fm, finalTeams = tm;
      if (!d.length && !m.length && !c.length && !fm.length) {
        const seed = seedData();
        finalDrills = seed.drills;
        finalMethods = seed.methods;
        finalCategories = seed.categories;
        finalThemes = seed.sessionThemes;
        finalFormats = seed.formats;
        finalTeams = seed.teams;
        await Promise.all([
          seedTable("categories", finalCategories),
          seedTable("session_themes", finalThemes),
          seedTable("teams", finalTeams),
          seedTable("drills", finalDrills),
          seedTable("methods", finalMethods),
          seedTable("formats", finalFormats),
        ]);
      }

      setDrills(finalDrills);
      setMethods(finalMethods);
      setCategories(finalCategories);
      setSessionThemes(finalThemes && finalThemes.length ? finalThemes : DEFAULT_THEMES);
      setSessions(s);
      setRatings(r);
      setPlayers(normalizePlayers(pl));
      setTeams(normalizeTeams(finalTeams.length ? finalTeams : DEFAULT_TEAMS));
      setFormats(finalFormats);
      setMatchdays(md);

      if (cs === null) {
        // The calendar_settings table itself couldn't be reached — most likely
        // the migration SQL hasn't been run yet. Don't try to seed (that would
        // just fail too); fall back to in-memory defaults and flag it clearly
        // rather than silently resetting settings on every reload.
        setCalendarTableMissing(true);
        setCalendarSettingsRows([DEFAULT_CALENDAR_SETTINGS]);
      } else if (cs.length > 0) {
        setCalendarSettingsRows(cs);
      } else {
        await seedTable("calendar_settings", [DEFAULT_CALENDAR_SETTINGS]);
        setCalendarSettingsRows([DEFAULT_CALENDAR_SETTINGS]);
      }

      if (tp && tp.length > 0) {
        const parsed = tp.map(item => typeof item.themeData === 'string' ? JSON.parse(item.themeData) : item.themeData);
        setCustomThemes([...BASE_THEMES, ...parsed.filter(p => !BASE_THEMES.some(b => b.id === p.id))]);
      }

      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const setters = {
      drills: setDrills, methods: setMethods, sessions: setSessions, ratings: setRatings,
      players: (v) => setPlayers(normalizePlayers(v)), formats: setFormats, matchdays: setMatchdays,
      categories: setCategories, session_themes: setSessionThemes, teams: (v) => setTeams(normalizeTeams(v)),
      calendar_settings: setCalendarSettingsRows,
    };
    const channel = supabase.channel("session-sheet-changes");
    [...ROW_TABLES, ...NAME_TABLES].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, async () => {
        const fresh = await fetchTable(table);
        if (fresh !== null && setters[table]) setters[table](fresh);
      });
    });
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const drillsRef = useRefValue(drills);
  const methodsRef = useRefValue(methods);
  const sessionsRef = useRefValue(sessions);
  const ratingsRef = useRefValue(ratings);
  const playersRef = useRefValue(players);
  const formatsRef = useRefValue(formats);
  const matchdaysRef = useRefValue(matchdays);
  const calendarSettingsRef = useRefValue(calendarSettingsRows);
  const categoriesRef = useRefValue(categories);
  const sessionThemesRef = useRefValue(sessionThemes);
  const teamsRef = useRefValue(teams);
  const customThemesRef = useRefValue(customThemes);

  const persistDrills = useCallback(async (next) => {
    setDrills(next);
    await syncRowTable("drills", drillsRef.current, next);
  }, []);
  const persistMethods = useCallback(async (next) => {
    setMethods(next);
    await syncRowTable("methods", methodsRef.current, next);
  }, []);
  const persistSessions = useCallback(async (next) => {
    setSessions(next);
    await syncRowTable("sessions", sessionsRef.current, next);
  }, []);
  const persistRatings = useCallback(async (next) => {
    setRatings(next);
    await syncRowTable("ratings", ratingsRef.current, next);
  }, []);
  const persistPlayers = useCallback(async (next) => {
    setPlayers(next);
    await syncRowTable("players", playersRef.current, next);
  }, []);
  const persistFormats = useCallback(async (next) => {
    setFormats(next);
    await syncRowTable("formats", formatsRef.current, next);
  }, []);
  const persistMatchdays = useCallback(async (next) => {
    setMatchdays(next);
    await syncRowTable("matchdays", matchdaysRef.current, next);
  }, []);
  const calendarSettings = calendarSettingsRows[0] || DEFAULT_CALENDAR_SETTINGS;
  const persistCalendarSettings = useCallback(async (nextSettings) => {
    const next = [{ ...nextSettings, id: "default" }];
    setCalendarSettingsRows(next);
    await syncRowTable("calendar_settings", calendarSettingsRef.current, next);
  }, []);
  const persistCategories = useCallback(async (next) => {
    setCategories(next);
    await syncNameTable("categories", categoriesRef.current, next);
  }, []);
  const persistSessionThemes = useCallback(async (next) => {
    setSessionThemes(next);
    await syncNameTable("session_themes", sessionThemesRef.current, next);
  }, []);
  const persistTeams = useCallback(async (next) => {
    setTeams(next);
    await syncNameTable("teams", teamsRef.current, next);
  }, []);

  const handleAddCustomTheme = async (newThemeObj) => {
    const updated = [...customThemes, newThemeObj];
    setCustomThemes(updated);
    setActiveThemeId(newThemeObj.id);
    setShowThemeModal(false);
    flash(`Added theme "${newThemeObj.name}"`);
    
    // Persist custom theme safely
    const customOnly = updated.filter(t => !BASE_THEMES.some(b => b.id === t.id));
    const themeRows = customOnly.map(t => ({ id: t.id, themeData: JSON.stringify(t) }));
    await syncRowTable("theme_presets", customThemesRef.current.filter(t => !BASE_THEMES.some(b => b.id === t.id)), themeRows);
  };

  const handleRemoveCustomTheme = async (themeId) => {
    if (BASE_THEMES.some(b => b.id === themeId)) {
      return flash("Cannot remove built-in system themes.");
    }
    const updated = customThemes.filter(t => t.id !== themeId);
    setCustomThemes(updated);
    if (activeThemeId === themeId) setActiveThemeId("pitch");
    flash("Theme removed");

    const customOnly = updated.filter(t => !BASE_THEMES.some(b => b.id === t.id));
    const themeRows = customOnly.map(t => ({ id: t.id, themeData: JSON.stringify(t) }));
    await syncRowTable("theme_presets", customThemesRef.current.filter(t => !BASE_THEMES.some(b => b.id === t.id)), themeRows);
  };

  const drillsByCategory = useMemo(() => {
    const map = {};
    categories.forEach((c) => (map[c] = []));
    drills.forEach((dr) => {
      if (!map[dr.category]) map[dr.category] = [];
      map[dr.category].push(dr);
    });
    return map;
  }, [drills, categories]);

  const avgRating = useCallback(
    (drillId) => {
      const rs = ratings.filter((r) => r.drillId === drillId);
      if (!rs.length) return null;
      return rs.reduce((a, b) => a + b.value, 0) / rs.length;
    },
    [ratings]
  );

  if (loading) {
    return (
      <div style={{ background: COLORS.chalk, minHeight: 480 }} className="flex items-center justify-center rounded-xl">
        <style>{FONT_IMPORT}</style>
        <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 1 }} className="text-2xl animate-pulse">
          Loading the team sheet…
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.chalk, fontFamily: "Inter" }} className="rounded-xl overflow-hidden transition-colors duration-300">
      <style>{FONT_IMPORT}</style>
      <Header 
        tab={tab} 
        setTab={setTab} 
        COLORS={COLORS} 
        customThemes={customThemes}
        activeThemeId={activeThemeId}
        setActiveThemeId={setActiveThemeId}
        onOpenThemeModal={() => setShowThemeModal(true)}
        tabOrder={calendarSettings.tabOrder}
      />
      {connectionWarning && (
        <div
          className="px-4 sm:px-6 py-2 text-xs font-semibold"
          style={{ background: "#FBE9C8", color: COLORS.amberDeep }}
        >
          Couldn't reach Supabase — check your VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars and that the tables exist.
        </div>
      )}
      <div className="p-4 sm:p-6">
        {tab === "plan" && (
          <PlanTab
            methods={methods}
            drills={drills}
            drillsByCategory={drillsByCategory}
            sessionThemes={sessionThemes}
            sessions={sessions}
            persistSessions={persistSessions}
            persistDrills={persistDrills}
            ratings={ratings}
            persistRatings={persistRatings}
            avgRating={avgRating}
            flash={flash}
            COLORS={COLORS}
          />
        )}
        {tab === "calendar" && (
          <CalendarTab
            sessions={sessions}
            matchdays={matchdays}
            calendarSettings={calendarSettings}
            persistCalendarSettings={persistCalendarSettings}
            calendarTableMissing={calendarTableMissing}
            setTab={setTab}
            flash={flash}
            COLORS={COLORS}
          />
        )}
        {tab === "drills" && (
          <DrillsTab
            drills={drills}
            categories={categories}
            sessionThemes={sessionThemes}
            sessions={sessions}
            persistDrills={persistDrills}
            persistCategories={persistCategories}
            persistSessionThemes={persistSessionThemes}
            avgRating={avgRating}
            flash={flash}
            COLORS={COLORS}
          />
        )}
        {tab === "methods" && (
          <MethodsTab
            methods={methods}
            categories={categories}
            persistMethods={persistMethods}
            flash={flash}
            COLORS={COLORS}
          />
        )}
        {tab === "matchday" && (
          <MatchDayTab
            players={players}
            teams={teams}
            formats={formats}
            matchdays={matchdays}
            persistPlayers={persistPlayers}
            persistTeams={persistTeams}
            persistFormats={persistFormats}
            persistMatchdays={persistMatchdays}
            flash={flash}
            COLORS={COLORS}
          />
        )}
      </div>

      {showThemeModal && (
        <ThemeModal
          customThemes={customThemes}
          activeThemeId={activeThemeId}
          onSelectTheme={setActiveThemeId}
          onAddTheme={handleAddCustomTheme}
          onRemoveTheme={handleRemoveCustomTheme}
          onClose={() => setShowThemeModal(false)}
          tabOrder={calendarSettings.tabOrder && calendarSettings.tabOrder.length ? calendarSettings.tabOrder : DEFAULT_TAB_ORDER}
          onReorderTabs={(next) => persistCalendarSettings({ ...calendarSettings, tabOrder: next })}
          COLORS={COLORS}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full shadow-lg text-sm font-semibold z-50"
          style={{ background: COLORS.pitch, color: "#fff", fontFamily: "Inter" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

const DEFAULT_TAB_DEFS = [
  { id: "plan", label: "Plan Session", icon: ClipboardList },
  { id: "drills", label: "Drills & Themes", icon: Layers },
  { id: "methods", label: "Methods", icon: BookOpen },
  { id: "matchday", label: "Match Day", icon: Users },
  { id: "calendar", label: "Calendar", icon: Calendar },
];
const DEFAULT_TAB_ORDER = DEFAULT_TAB_DEFS.map((t) => t.id);

function Header({ tab, setTab, COLORS, customThemes, activeThemeId, setActiveThemeId, onOpenThemeModal, tabOrder }) {
  const order = tabOrder && tabOrder.length ? tabOrder : DEFAULT_TAB_ORDER;
  const tabs = order
    .map((id) => DEFAULT_TAB_DEFS.find((t) => t.id === id))
    .filter(Boolean);
  // Catch any tab that isn't in the saved order yet (e.g. a newly added tab)
  DEFAULT_TAB_DEFS.forEach((t) => { if (!tabs.some((x) => x.id === t.id)) tabs.push(t); });
  return (
    <div style={{ background: COLORS.pitch }} className="relative px-4 sm:px-6 pt-5 pb-0 overflow-hidden transition-colors duration-300">
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent, transparent 38px, #fff 38px, #fff 40px)",
        }}
      />
      <div className="relative flex items-center justify-between mb-4">
        <div>
          <div style={{ fontFamily: "Bebas Neue", color: "#fff", letterSpacing: 1.5 }} className="text-3xl leading-none">
            SESSION SHEET
          </div>
          <div style={{ color: COLORS.amber, fontFamily: "JetBrains Mono" }} className="text-[11px] mt-1 uppercase tracking-widest">
            Plan · Track · Rate
          </div>
        </div>

        {/* Theme Picker Header Control */}
        <div className="flex items-center gap-2">
          <select
            value={activeThemeId}
            onChange={(e) => setActiveThemeId(e.target.value)}
            className="text-xs rounded-lg px-2 py-1.5 font-medium border-none outline-none shadow-sm"
            style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
          >
            {customThemes.map((t) => (
              <option key={t.id} value={t.id} style={{ color: "#000" }}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={onOpenThemeModal}
            className="p-1.5 rounded-lg text-white hover:bg-white/20 transition-colors"
            title="Manage Visual Themes"
          >
            <Palette size={18} />
          </button>
        </div>
      </div>
      <div className="relative flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap rounded-t-lg"
              style={{
                fontFamily: "Inter",
                background: active ? COLORS.chalk : "transparent",
                color: active ? COLORS.pitch : "rgba(255,255,255,0.75)",
              }}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function resolveCategory(phase, theme) {
  return phase.defaultCategory === THEME_MARKER ? theme : phase.defaultCategory;
}

function getPool(resolvedCategory, theme, drillsByCategory) {
  if (resolvedCategory === CONDITIONAL_GAME) {
    const all = drillsByCategory[CONDITIONAL_GAME] || [];
    const themed = all.filter((d) => !d.theme || d.theme === theme);
    return themed.length ? themed : all;
  }
  return drillsByCategory[resolvedCategory] || [];
}

function SessionRow({ session, drills, ratings, onComplete, onDelete, onRate, isOpen, onToggle, flash, COLORS }) {
  const exportRef = React.useRef(null);
  const ratingFor = (drillId) =>
    ratings.find((r) => r.sessionId === session.id && r.drillId === drillId)?.value || 0;

  return (
    <Card className="overflow-hidden mb-2">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div className="flex items-center gap-3">
          {isOpen ? <ChevronDown size={16} color={COLORS.inkSoft} /> : <ChevronRight size={16} color={COLORS.inkSoft} />}
          <div>
            <div className="text-sm font-bold" style={{ color: COLORS.ink, fontFamily: "Inter" }}>{session.date}</div>
            <div className="text-xs" style={{ color: COLORS.inkSoft }}>
              {session.methodName}{session.theme ? ` · ${session.theme}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session.status === "completed" ? (
            <Pill tone="pitch" COLORS={COLORS}>Completed</Pill>
          ) : (
            <Pill tone="amber" COLORS={COLORS}>Planned</Pill>
          )}
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <div ref={exportRef} className="p-1">
            <div className="text-sm font-bold mb-2" style={{ color: COLORS.ink, fontFamily: "Inter" }}>
              {session.date} — {session.methodName}{session.theme ? ` · ${session.theme}` : ""}
            </div>
            <div className="space-y-2 mb-3">
              {session.phases.map((p, idx) => {
                const drill = drills.find((d) => d.id === p.drillId);
                const isFullGame = p.category === FULL_GAME;
                return (
                  <div key={p.phaseId || idx} className="rounded-lg p-2.5 flex items-center justify-between gap-3" style={{ background: COLORS.chalkDim }}>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide" style={{ color: COLORS.inkSoft }}>{p.label}</div>
                      <div className="text-sm font-semibold" style={{ color: COLORS.ink }}>
                        {isFullGame ? "Free play" : drill?.name || "—"}
                      </div>
                    </div>
                    {session.status === "completed" && drill && (
                      <StarRating value={ratingFor(drill.id)} onChange={(v) => onRate(session, drill.id, v)} COLORS={COLORS} />
                    )}
                  </div>
                );
              })}
            </div>
            {session.notes && (
              <p className="text-xs mb-3 italic" style={{ color: COLORS.inkSoft }}>"{session.notes}"</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {session.status !== "completed" && (
              <Button variant="dark" size="sm" icon={CheckCircle2} onClick={() => onComplete(session)} COLORS={COLORS}>
                Mark complete
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={Share2}
              onClick={() => exportElementAsImage(exportRef.current, `session-${session.date}.png`, flash)}
              COLORS={COLORS}
            >
              Share Image
            </Button>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => onDelete(session.id)} COLORS={COLORS}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PlanTab({ methods, drills, drillsByCategory, sessionThemes, sessions, persistSessions, persistDrills, ratings, persistRatings, avgRating, flash, COLORS }) {
  const drillUsage = useMemo(() => computeDrillUsage(sessions), [sessions]);
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [theme, setTheme] = useState(sessionThemes[0] || "Shooting");
  const [date, setDate] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState([]);

  const selectedMethod = methods.find((m) => m.id === methodId);
  const usesTheme = selectedMethod?.phases.some((p) => p.defaultCategory === THEME_MARKER);

  useEffect(() => {
    if (selectedMethod) {
      setSlots(
        selectedMethod.phases.map((p) => ({
          phaseId: p.id || uid(),
          label: p.label,
          category: resolveCategory(p, theme),
          drillId: "",
        }))
      );
    } else {
      setSlots([]);
    }
  }, [methodId]);

  useEffect(() => {
    if (!selectedMethod) return;
    setSlots((prev) =>
      prev.map((s, i) => {
        const phase = selectedMethod.phases[i];
        const resolved = resolveCategory(phase, theme);
        if (resolved === s.category) return s;
        return { ...s, category: resolved, drillId: "" };
      })
    );
  }, [theme]);

  const updateSlot = (idx, patch) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const leastUsedPick = (category) => {
    const pool = getPool(category, theme, drillsByCategory);
    if (!pool.length) return "";
    const min = Math.min(...pool.map((d) => drillUsage[d.id] || 0));
    const candidates = pool.filter((d) => (drillUsage[d.id] || 0) === min);
    return candidates[Math.floor(Math.random() * candidates.length)].id;
  };

  const autoGenerate = () => {
    if (!selectedMethod) {
      flash("Pick a coaching method first");
      return;
    }
    setSlots((prev) =>
      prev.map((s) =>
        s.category === FULL_GAME ? s : { ...s, drillId: leastUsedPick(s.category) }
      )
    );
    flash("Auto-picked drills (favouring the least-used ones)");
  };

  const saveSession = async () => {
    if (!selectedMethod) return flash("Pick a coaching method first");
    if (slots.some((s) => s.category !== FULL_GAME && !s.drillId)) return flash("Every phase needs a drill selected");
    const session = {
      id: uid(),
      date,
      methodId,
      methodName: selectedMethod.name,
      theme: usesTheme ? theme : null,
      notes,
      status: "planned",
      phases: slots.map((s) => ({ ...s })),
    };
    await persistSessions([session, ...sessions]);
    flash("Session saved to your plan");
    setNotes("");
  };

  const [expandedId, setExpandedId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const completeSession = async (session) => {
    // Usage counts are derived from completed sessions (see computeDrillUsage),
    // so there's no separate counter to bump here.
    const nextSessions = sessions.map((s) => (s.id === session.id ? { ...s, status: "completed" } : s));
    await persistSessions(nextSessions);
    flash("Marked complete — drill usage updated");
    setExpandedId(session.id);
  };

  const deleteSession = async (id) => {
    await persistSessions(sessions.filter((s) => s.id !== id));
    flash("Session deleted");
  };

  const rateDrill = async (session, drillId, value) => {
    const existing = ratings.find((r) => r.sessionId === session.id && r.drillId === drillId);
    let next;
    if (existing) {
      next = ratings.map((r) => (r.id === existing.id ? { ...r, value } : r));
    } else {
      next = [...ratings, { id: uid(), sessionId: session.id, drillId, value, date: session.date }];
    }
    await persistRatings(next);
  };

  const upcomingSessions = sessions
    .filter((s) => s.status !== "completed")
    .sort((a, b) => a.date.localeCompare(b.date));
  const historySessions = sessions
    .filter((s) => s.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6">
      <div>
        <Card className="p-4 sm:p-5 mb-4">
          <div className="grid sm:grid-cols-2 gap-3 mb-3 items-end">
            <div>
              <Label COLORS={COLORS}>Date</Label>
              <div className="max-w-[170px]">
                <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} COLORS={COLORS} />
              </div>
            </div>
            <div>
              <Label COLORS={COLORS}>Coaching method</Label>
              <Select
                value={methodId}
                onChange={setMethodId}
                options={methods.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="Choose a method…"
                COLORS={COLORS}
              />
            </div>
          </div>
          <div>
            <Label COLORS={COLORS}>Session theme</Label>
            <div className="flex flex-wrap gap-2">
              {sessionThemes.map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-full uppercase tracking-wide"
                  style={{
                    background: theme === t ? COLORS.amber : COLORS.chalkDim,
                    color: COLORS.ink,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {!usesTheme && selectedMethod && (
              <p className="text-[11px] mt-1.5" style={{ color: COLORS.inkSoft }}>
                This method doesn't use a themed skill phase, but the theme still steers the conditional game pick.
              </p>
            )}
          </div>
        </Card>

        {selectedMethod ? (
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-xl">
                LINE-UP — {selectedMethod.name.toUpperCase()}
              </div>
              <Button variant="dark" icon={Shuffle} onClick={autoGenerate} COLORS={COLORS}>Auto-generate</Button>
            </div>
            <div className="relative pl-8">
              <div className="absolute left-[15px] top-2 bottom-2 w-0.5 border-l-2 border-dashed" style={{ borderColor: "#D9D3C1" }} />
              <div className="space-y-4">
                {slots.map((s, idx) => {
                  const isFullGame = s.category === FULL_GAME;
                  const pool = getPool(s.category, theme, drillsByCategory);
                  const drill = drills.find((d) => d.id === s.drillId);
                  return (
                    <div key={s.phaseId || idx} className="relative">
                      <div
                        className="absolute -left-8 top-1 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: COLORS.amber, color: COLORS.ink, fontFamily: "JetBrains Mono" }}
                      >
                        {idx + 1}
                      </div>
                      <div className="rounded-lg border p-3" style={{ borderColor: "#E4DFD0" }}>
                        <div className="flex items-center justify-between mb-2">
                          <div style={{ fontFamily: "Inter", color: COLORS.ink }} className="font-semibold text-sm">
                            {s.label}
                          </div>
                          <Pill tone="chalk" COLORS={COLORS}>{s.category}</Pill>
                        </div>

                        {isFullGame ? (
                          <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: COLORS.chalkDim }}>
                            <Users size={15} color={COLORS.inkSoft} />
                            <p className="text-xs" style={{ color: COLORS.inkSoft }}>
                              Free play — no drill needed, just get the match going.
                            </p>
                          </div>
                        ) : (
                          <>
                            <Select
                              value={s.drillId}
                              onChange={(v) => updateSlot(idx, { drillId: v })}
                              options={pool.map((d) => ({
                                value: d.id,
                                label: `${d.name}${drillUsage[d.id] ? ` · used ${drillUsage[d.id]}×` : ""}`,
                              }))}
                              placeholder="Select a drill…"
                              COLORS={COLORS}
                            />
                            {drill && (
                              <div className="mt-2 flex items-center justify-between">
                                <p className="text-xs" style={{ color: COLORS.inkSoft }}>{drill.description}</p>
                                {avgRating(drill.id) != null && (
                                  <div className="flex items-center gap-1 shrink-0 ml-2">
                                    <Star size={12} fill={COLORS.amber} color={COLORS.amber} />
                                    <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>
                                      {avgRating(drill.id).toFixed(1)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <Label COLORS={COLORS}>Session notes (optional)</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. focus on weaker foot, small pitch due to rain…"
                className="w-full text-sm rounded-lg px-2.5 py-2 border outline-none resize-none"
                style={{ fontFamily: "Inter", borderColor: "#D9D3C1" }}
              />
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="primary" size="lg" icon={Save} onClick={saveSession} COLORS={COLORS}>Save session</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-sm" style={{ color: COLORS.inkSoft }}>Choose a coaching method above to build your session.</p>
          </Card>
        )}
      </div>

      <div>
        <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-xl mb-3">
          UPCOMING SESSIONS
        </div>
        {upcomingSessions.length === 0 && (
          <Card className="p-6 text-center">
            <p className="text-sm" style={{ color: COLORS.inkSoft }}>No planned sessions yet — build one above.</p>
          </Card>
        )}
        {upcomingSessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            drills={drills}
            ratings={ratings}
            onComplete={completeSession}
            onDelete={deleteSession}
            onRate={rateDrill}
            isOpen={expandedId === s.id}
            onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
            flash={flash}
            COLORS={COLORS}
          />
        ))}
      </div>

      {historySessions.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center gap-2 p-3 rounded-lg"
            style={{ background: COLORS.chalkDim }}
          >
            {showHistory ? <ChevronDown size={16} color={COLORS.inkSoft} /> : <ChevronRight size={16} color={COLORS.inkSoft} />}
            <span style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-lg">
              HISTORY ({historySessions.length})
            </span>
          </button>
          {showHistory && (
            <div className="mt-3">
              {historySessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  drills={drills}
                  ratings={ratings}
                  onComplete={completeSession}
                  onDelete={deleteSession}
                  onRate={rateDrill}
                  isOpen={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  flash={flash}
                  COLORS={COLORS}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- CALENDAR TAB ----------
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Internally weekday index follows JS's Date.getDay() (0=Sun..6=Sat) so it lines
// up directly with date math; WEEKDAY_LABELS is just displayed Mon-first.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Rasterizes a DOM node to a PNG and either opens the native share sheet
// (so it can be saved straight to Photos on iPhone) or downloads it, whichever
// the device/browser supports.
async function exportElementAsImage(node, filename, flash) {
  if (!node) return;
  try {
    const dataUrl = await toPng(node, { backgroundColor: "#ffffff", pixelRatio: 2, cacheBust: true });
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
    } else {
      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      flash && flash("Image downloaded");
    }
  } catch (e) {
    flash && flash("Couldn't create the image — try again");
  }
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function CalendarTab({ sessions, matchdays, calendarSettings, persistCalendarSettings, calendarTableMissing, setTab, flash, COLORS }) {
  const [cursor, setCursor] = useState(() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const trainingDays = calendarSettings.trainingDays || [];
  const playingDays = calendarSettings.playingDays || [];
  const holidays = calendarSettings.holidays || [];

  const toggleWeekday = (arrKey, day) => {
    const current = calendarSettings[arrKey] || [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    persistCalendarSettings({ ...calendarSettings, [arrKey]: next });
  };

  const toggleHoliday = (dateStr) => {
    const next = holidays.includes(dateStr)
      ? holidays.filter((h) => h !== dateStr)
      : [...holidays, dateStr].sort();
    persistCalendarSettings({ ...calendarSettings, holidays: next });
  };
  const removeHoliday = (date) => {
    persistCalendarSettings({ ...calendarSettings, holidays: holidays.filter((h) => h !== date) });
  };

  const sessionsByDate = useMemo(() => {
    const map = {};
    sessions.forEach((s) => { (map[s.date] = map[s.date] || []).push(s); });
    return map;
  }, [sessions]);
  const matchdaysByDate = useMemo(() => {
    const map = {};
    matchdays.forEach((m) => { (map[m.date] = map[m.date] || []).push(m); });
    return map;
  }, [matchdays]);

  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=Mon
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.year, cursor.month, d));

  const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const changeMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDate(null);
  };

  const today = todayStr();
  const selectedSessions = selectedDate ? (sessionsByDate[selectedDate] || []) : [];
  const selectedMatchdays = selectedDate ? (matchdaysByDate[selectedDate] || []) : [];

  return (
    <div className="space-y-5">
      {calendarTableMissing && (
        <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "#FBE9C8", color: COLORS.amberDeep }}>
          Holidays, training/playing days, and tab order aren't saving — the <code>calendar_settings</code> table
          couldn't be reached in Supabase. Run <code>calendar_settings_migration.sql</code> in the Supabase SQL Editor,
          then reload this page.
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="subtle" size="sm" icon={ChevronLeft} onClick={() => changeMonth(-1)} COLORS={COLORS} />
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-2xl min-w-[180px] text-center">
            {monthLabel.toUpperCase()}
          </div>
          <Button variant="subtle" size="sm" icon={ChevronRight} onClick={() => changeMonth(1)} COLORS={COLORS} />
        </div>
        <Button variant="ghost" size="sm" icon={showSettings ? X : Settings} onClick={() => setShowSettings(!showSettings)} COLORS={COLORS}>
          {showSettings ? "Close" : "Configure"}
        </Button>
      </div>

      {showSettings && (
        <Card className="p-4 sm:p-5">
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <Label COLORS={COLORS}>Training days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_ORDER.map((day, i) => (
                  <button
                    key={day}
                    onClick={() => toggleWeekday("trainingDays", day)}
                    className="px-3 py-1.5 text-xs font-bold rounded-full"
                    style={{
                      background: trainingDays.includes(day) ? COLORS.pitchLight : COLORS.chalkDim,
                      color: trainingDays.includes(day) ? "#fff" : COLORS.ink,
                    }}
                  >
                    {WEEKDAY_LABELS[i]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label COLORS={COLORS}>Playing days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_ORDER.map((day, i) => (
                  <button
                    key={day}
                    onClick={() => toggleWeekday("playingDays", day)}
                    className="px-3 py-1.5 text-xs font-bold rounded-full"
                    style={{
                      background: playingDays.includes(day) ? COLORS.amber : COLORS.chalkDim,
                      color: COLORS.ink,
                    }}
                  >
                    {WEEKDAY_LABELS[i]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Label COLORS={COLORS}>Holidays / blocked-out dates</Label>
          <p className="text-xs mb-2" style={{ color: COLORS.inkSoft }}>
            Hover any date in the calendar below and click the small toggle that appears to mark or unmark it as a holiday.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {holidays.map((h) => (
              <div key={h} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full" style={{ background: COLORS.chalkDim }}>
                <span className="text-xs font-semibold" style={{ color: COLORS.ink }}>{h}</span>
                <button onClick={() => removeHoliday(h)}><X size={12} color={COLORS.inkSoft} /></button>
              </div>
            ))}
            {holidays.length === 0 && <p className="text-xs" style={{ color: COLORS.inkSoft }}>No holidays marked yet.</p>}
          </div>
        </Card>
      )}

      <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: COLORS.inkSoft }}>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: COLORS.pitchLight }} /> Training day</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: COLORS.amber }} /> Playing day</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: "#ccc" }} /> Holiday</span>
        <span className="flex items-center gap-1.5"><ClipboardList size={13} /> Session scheduled</span>
        <span className="flex items-center gap-1.5"><Users size={13} /> Match day scheduled</span>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="text-center text-[11px] font-bold uppercase" style={{ color: COLORS.inkSoft }}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, idx) => {
            if (!d) return <div key={idx} />;
            const dateStr = ymd(d);
            const weekday = d.getDay();
            const isHoliday = holidays.includes(dateStr);
            const isTraining = !isHoliday && trainingDays.includes(weekday);
            const isPlaying = !isHoliday && playingDays.includes(weekday);
            const daySessions = sessionsByDate[dateStr] || [];
            const dayMatchdays = matchdaysByDate[dateStr] || [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;

            let bg = "#fff";
            if (isHoliday) bg = "#EDEDED";
            else if (isTraining && isPlaying) bg = `linear-gradient(135deg, ${hexToRgba(COLORS.pitchLight, 0.18)} 50%, ${hexToRgba(COLORS.amber, 0.22)} 50%)`;
            else if (isTraining) bg = hexToRgba(COLORS.pitchLight, 0.14);
            else if (isPlaying) bg = hexToRgba(COLORS.amber, 0.16);

            return (
              <div
                key={idx}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className="group rounded-lg p-1.5 text-left min-h-[62px] relative cursor-pointer"
                style={{
                  background: bg,
                  border: isSelected ? `2px solid ${COLORS.pitch}` : isToday ? `1.5px solid ${COLORS.amber}` : "1px solid transparent",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold" style={{ color: isHoliday ? "#999" : COLORS.ink }}>{d.getDate()}</div>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleHoliday(dateStr); }}
                    title={isHoliday ? "Unmark as holiday" : "Mark as holiday"}
                    className="w-4 h-4 rounded-full flex items-center justify-center opacity-25 group-hover:opacity-100 transition-opacity"
                    style={{ background: isHoliday ? COLORS.pitch : "#bbb" }}
                  >
                    <X size={9} color="#fff" strokeWidth={3} />
                  </button>
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {daySessions.length > 0 && <ClipboardList size={12} color={COLORS.pitch} />}
                  {dayMatchdays.length > 0 && <Users size={12} color={COLORS.amberDeep || COLORS.pitch} />}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {selectedDate && (
        <Card className="p-4 sm:p-5">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-lg mb-3">
            {selectedDate}
          </div>
          {selectedSessions.length === 0 && selectedMatchdays.length === 0 && (
            <p className="text-sm" style={{ color: COLORS.inkSoft }}>Nothing scheduled on this day.</p>
          )}
          <div className="space-y-2">
            {selectedSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg p-2.5" style={{ background: COLORS.chalkDim }}>
                <div className="flex items-center gap-2">
                  <ClipboardList size={15} color={COLORS.pitch} />
                  <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>
                    {s.methodName}{s.theme ? ` · ${s.theme}` : ""}
                  </span>
                  <Pill tone={s.status === "completed" ? "pitch" : "amber"} COLORS={COLORS}>
                    {s.status === "completed" ? "Completed" : "Planned"}
                  </Pill>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setTab("plan")} COLORS={COLORS}>Open</Button>
              </div>
            ))}
            {selectedMatchdays.map((md) => (
              <div key={md.id} className="flex items-center justify-between rounded-lg p-2.5" style={{ background: COLORS.chalkDim }}>
                <div className="flex items-center gap-2">
                  <Users size={15} color={COLORS.pitch} />
                  <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>
                    {(md.games || []).length} game{(md.games || []).length === 1 ? "" : "s"} · {(md.presentPlayerIds || []).length} present
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setTab("matchday")} COLORS={COLORS}>Open</Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function DrillsTab({ drills, categories, sessionThemes, sessions, persistDrills, persistCategories, persistSessionThemes, avgRating, flash, COLORS }) {
  const drillUsage = useMemo(() => computeDrillUsage(sessions), [sessions]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [drillTheme, setDrillTheme] = useState("");
  const [description, setDescription] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newTheme, setNewTheme] = useState("");
  const [filter, setFilter] = useState("All");
  const [editingId, setEditingId] = useState(null);

  // Modal deletion workflow for category safety prompt
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [reassignTarget, setReassignTarget] = useState("");

  const resetForm = () => {
    setName("");
    setDescription("");
    setDrillTheme("");
    setCategory(categories[0] || "");
    setEditingId(null);
  };

  const startEdit = (d) => {
    setEditingId(d.id);
    setName(d.name);
    setCategory(d.category);
    setDrillTheme(d.theme || "");
    setDescription(d.description || "");
  };

  const addDrill = async () => {
    if (!name.trim()) return flash("Give the drill a name");
    if (!category) return flash("Choose a category");
    if (editingId) {
      await persistDrills(
        drills.map((d) =>
          d.id === editingId
            ? { ...d, name: name.trim(), category, theme: category === CONDITIONAL_GAME ? drillTheme : "", description: description.trim() }
            : d
        )
      );
      flash("Drill updated");
    } else {
      await persistDrills([
        { id: uid(), name: name.trim(), category, theme: category === CONDITIONAL_GAME ? drillTheme : "", description: description.trim(), timesUsed: 0 },
        ...drills,
      ]);
      flash("Drill added");
    }
    resetForm();
  };

  const removeDrill = async (id) => {
    await persistDrills(drills.filter((d) => d.id !== id));
    if (editingId === id) resetForm();
    flash("Drill removed");
  };

  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const importBulkDrills = async () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return flash("Paste at least one line to import");
    const newDrills = [];
    let skipped = 0;
    lines.forEach((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const [lName, lCategory, lTheme, ...rest] = parts;
      const lDescription = rest.join(",").trim();
      if (!lName || !lCategory || !categories.includes(lCategory)) {
        skipped += 1;
        return;
      }
      newDrills.push({
        id: uid(),
        name: lName,
        category: lCategory,
        theme: lCategory === CONDITIONAL_GAME ? (lTheme || "") : "",
        description: lDescription || "",
        timesUsed: 0,
      });
    });
    if (newDrills.length) await persistDrills([...newDrills, ...drills]);
    flash(
      skipped
        ? `Imported ${newDrills.length} — skipped ${skipped} (name/category missing or category doesn't match exactly)`
        : `Imported ${newDrills.length} drill${newDrills.length === 1 ? "" : "s"}`
    );
    setBulkText("");
  };

  const addCategory = async () => {
    const c = newCategory.trim();
    if (!c) return;
    if (categories.includes(c)) return flash("Category already exists");
    await persistCategories([...categories, c]);
    setNewCategory("");
    flash("Category added");
  };

  const addTheme = async () => {
    const t = newTheme.trim();
    if (!t) return;
    if (sessionThemes.includes(t)) return flash("Theme already exists");
    await persistSessionThemes([...sessionThemes, t]);
    setNewTheme("");
    flash("Theme added");
  };

  const removeTheme = async (t) => {
    await persistSessionThemes(sessionThemes.filter((x) => x !== t));
    flash("Theme removed");
  };

  // Safe category deletion implementation
  const handleInitiateDeleteCategory = (catName) => {
    if (categories.length <= 1) {
      return flash("Must keep at least one category.");
    }
    const remaining = categories.filter((c) => c !== catName);
    setCategoryToDelete(catName);
    setReassignTarget(remaining[0] || "");
  };

  const executeCategoryDeletion = async (action) => {
    if (!categoryToDelete) return;

    let updatedDrills = [...drills];
    if (action === "reassign") {
      updatedDrills = drills.map((d) =>
        d.category === categoryToDelete ? { ...d, category: reassignTarget } : d
      );
    } else if (action === "cascade") {
      updatedDrills = drills.filter((d) => d.category !== categoryToDelete);
    }

    const updatedCategories = categories.filter((c) => c !== categoryToDelete);

    await persistDrills(updatedDrills);
    await persistCategories(updatedCategories);

    if (filter === categoryToDelete) setFilter("All");
    setCategoryToDelete(null);
    flash(`Removed category "${categoryToDelete}"`);
  };

  const shown = filter === "All" ? drills : drills.filter((d) => d.category === filter);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-5 min-w-0">
      <div className="space-y-4">
        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">
            {editingId ? "EDIT DRILL" : "ADD A DRILL"}
          </div>
          <div className="space-y-2">
            <TextInput placeholder="Drill name" value={name} onChange={(e) => setName(e.target.value)} COLORS={COLORS} />
            <Select value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} COLORS={COLORS} />
            {category === CONDITIONAL_GAME && (
              <Select
                value={drillTheme}
                onChange={setDrillTheme}
                options={sessionThemes.map((t) => ({ value: t, label: t }))}
                placeholder="Which theme fits? (optional — works for any)"
                COLORS={COLORS}
              />
            )}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short description (optional)"
              className="w-full text-sm rounded-lg px-2.5 py-2 border outline-none resize-none"
              style={{ borderColor: "#D9D3C1" }}
            />
            <div className="flex gap-2">
              <Button variant="primary" icon={editingId ? Save : Plus} onClick={addDrill} COLORS={COLORS}>
                {editingId ? "Save changes" : "Add drill"}
              </Button>
              {editingId && (
                <Button variant="subtle" onClick={resetForm} COLORS={COLORS}>Cancel</Button>
              )}
            </div>
          </div>
        </Card>

        {/* Bulk drill import */}
        <Card className="p-4">
          <button
            onClick={() => setShowBulkImport(!showBulkImport)}
            className="w-full flex items-center justify-between"
          >
            <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg">BULK IMPORT</div>
            {showBulkImport ? <ChevronDown size={16} color={COLORS.inkSoft} /> : <ChevronRight size={16} color={COLORS.inkSoft} />}
          </button>
          {showBulkImport && (
            <div className="mt-3 space-y-2">
              <p className="text-xs" style={{ color: COLORS.inkSoft }}>
                One drill per line: <code>Name, Category, Theme, Description</code> — Theme and Description are optional.
                Category must match one of your existing categories exactly ({categories.join(", ")}).
              </p>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={6}
                placeholder={"Cone Weave, Dribbling\nPassing Triangles, Passing, , Three cones in a triangle, one-touch passing"}
                className="w-full text-xs font-mono rounded-lg px-2.5 py-2 border outline-none resize-none"
                style={{ borderColor: "#D9D3C1" }}
              />
              <Button variant="primary" icon={Plus} onClick={importBulkDrills} COLORS={COLORS}>Import drills</Button>
            </div>
          )}
        </Card>


        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">CATEGORIES</div>
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto">
            {categories.map((c) => (
              <div
                key={c}
                className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium"
                style={{ background: COLORS.chalkDim, color: COLORS.ink }}
              >
                <span>{c}</span>
                <button
                  onClick={() => handleInitiateDeleteCategory(c)}
                  className="hover:text-red-500 p-0.5 rounded-full"
                  title="Remove category"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <TextInput placeholder="e.g. Goalkeeping" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} COLORS={COLORS} />
            <Button variant="dark" icon={Plus} onClick={addCategory} COLORS={COLORS}>Add</Button>
          </div>
        </Card>

        {/* Session Theme Management */}
        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">SESSION THEMES</div>
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto">
            {sessionThemes.map((t) => (
              <div
                key={t}
                className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium"
                style={{ background: COLORS.amber, color: COLORS.ink }}
              >
                <span>{t}</span>
                <button
                  onClick={() => removeTheme(t)}
                  className="hover:text-red-700 p-0.5 rounded-full"
                  title="Remove theme"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <TextInput placeholder="e.g. Heading" value={newTheme} onChange={(e) => setNewTheme(e.target.value)} COLORS={COLORS} />
            <Button variant="dark" icon={Plus} onClick={addTheme} COLORS={COLORS}>Add</Button>
          </div>
        </Card>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1 max-w-full">
          {["All", ...categories].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className="px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap shrink-0"
              style={{
                background: filter === c ? COLORS.pitch : COLORS.chalkDim,
                color: filter === c ? "#fff" : COLORS.ink,
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3 min-w-0">
          {shown.map((d) => (
            <Card key={d.id} className="p-3.5 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold truncate" style={{ color: COLORS.ink }}>{d.name}</div>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    <Pill tone="chalk" COLORS={COLORS}>{d.category}</Pill>
                    {d.theme && <Pill tone="amber" COLORS={COLORS}>{d.theme}</Pill>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(d)} title="Edit drill">
                    <Edit3 size={15} color={COLORS.inkSoft} />
                  </button>
                  <button onClick={() => removeDrill(d.id)} title="Delete drill">
                    <Trash2 size={15} color={COLORS.danger} />
                  </button>
                </div>
              </div>
              {d.description && (
                <p className="text-xs mt-2 break-words" style={{ color: COLORS.inkSoft }}>{d.description}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] font-mono" style={{ color: COLORS.inkSoft, fontFamily: "JetBrains Mono" }}>
                  Used {drillUsage[d.id] || 0}×
                </span>
                {avgRating(d.id) != null ? (
                  <div className="flex items-center gap-1">
                    <Star size={13} fill={COLORS.amber} color={COLORS.amber} />
                    <span className="text-xs font-semibold" style={{ color: COLORS.inkSoft }}>{avgRating(d.id).toFixed(1)}</span>
                  </div>
                ) : (
                  <span className="text-[11px]" style={{ color: COLORS.inkSoft }}>No ratings yet</span>
                )}
              </div>
            </Card>
          ))}
          {shown.length === 0 && (
            <p className="text-sm col-span-2 text-center py-8" style={{ color: COLORS.inkSoft }}>No drills in this category yet.</p>
          )}
        </div>
      </div>

      {/* Category Deletion Safety Confirmation Modal */}
      {categoryToDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={20} />
              <h3 className="font-bold text-base">Delete Category "{categoryToDelete}"?</h3>
            </div>
            
            <p className="text-xs text-gray-600">
              There are drills assigned to this category. How would you like to handle existing drills?
            </p>

            <div className="space-y-3 pt-2">
              <div className="p-3 bg-gray-50 rounded-lg space-y-2 border border-gray-200">
                <p className="text-xs font-semibold text-gray-700">Option 1: Reassign Drills</p>
                <div className="flex items-center gap-2">
                  <Select
                    value={reassignTarget}
                    onChange={setReassignTarget}
                    options={categories
                      .filter((c) => c !== categoryToDelete)
                      .map((c) => ({ value: c, label: c }))}
                    COLORS={COLORS}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => executeCategoryDeletion("reassign")}
                    COLORS={COLORS}
                  >
                    Reassign
                  </Button>
                </div>
              </div>

              <div className="p-3 bg-red-50 rounded-lg space-y-2 border border-red-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-red-800">Option 2: Delete All Drills</p>
                  <p className="text-[10px] text-red-600">Permanently removes assigned drills.</p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => executeCategoryDeletion("cascade")}
                  COLORS={COLORS}
                >
                  Delete All
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="subtle" size="sm" onClick={() => setCategoryToDelete(null)} COLORS={COLORS}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function MethodsTab({ methods, categories, persistMethods, flash, COLORS }) {
  const [name, setName] = useState("");
  const [phases, setPhases] = useState([{ id: uid(), label: "", defaultCategory: THEME_MARKER }]);
  const [editingId, setEditingId] = useState(null);

  const phaseCategoryOptions = [
    { value: THEME_MARKER, label: "Theme (session focus)" },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  const addPhase = () => setPhases((p) => [...p, { id: uid(), label: "", defaultCategory: THEME_MARKER }]);
  const updatePhase = (idx, patch) =>
    setPhases((p) => p.map((ph, i) => (i === idx ? { ...ph, ...patch } : ph)));
  const removePhase = (idx) => setPhases((p) => p.filter((_, i) => i !== idx));

  const resetForm = () => {
    setName("");
    setPhases([{ id: uid(), label: "", defaultCategory: THEME_MARKER }]);
    setEditingId(null);
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setName(m.name);
    setPhases(m.phases.map((p) => ({ ...p })));
  };

  const saveMethod = async () => {
    if (!name.trim()) return flash("Name the method");
    if (phases.some((p) => !p.label.trim())) return flash("Every phase needs a label");
    if (editingId) {
      await persistMethods(
        methods.map((m) =>
          m.id === editingId
            ? { ...m, name: name.trim(), phases: phases.map((p) => ({ ...p, label: p.label.trim() })) }
            : m
        )
      );
      flash("Method updated");
    } else {
      await persistMethods([...methods, { id: uid(), name: name.trim(), phases: phases.map((p) => ({ ...p, label: p.label.trim() })) }]);
      flash("Method saved");
    }
    resetForm();
  };

  const deleteMethod = async (id) => {
    await persistMethods(methods.filter((m) => m.id !== id));
    if (editingId === id) resetForm();
    flash("Method deleted");
  };

  const labelFor = (cat) => (cat === THEME_MARKER ? "Theme" : cat);

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-5">
      <div className="space-y-3">
        {methods.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-lg">
                {m.name.toUpperCase()}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => startEdit(m)} title="Edit method">
                  <Edit3 size={15} color={COLORS.inkSoft} />
                </button>
                <button onClick={() => deleteMethod(m.id)} title="Delete method">
                  <Trash2 size={15} color={COLORS.danger} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {m.phases.map((p, i) => (
                <React.Fragment key={p.id || i}>
                  <Pill tone="chalk" COLORS={COLORS}>{p.label} <span style={{ opacity: 0.6 }}>· {labelFor(p.defaultCategory)}</span></Pill>
                  {i < m.phases.length - 1 && <span style={{ color: COLORS.inkSoft }}>→</span>}
                </React.Fragment>
              ))}
            </div>
          </Card>
        ))}
        {methods.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-sm" style={{ color: COLORS.inkSoft }}>No methods yet — build one on the right.</p>
          </Card>
        )}
      </div>

      <Card className="p-4 h-fit">
        <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">
          {editingId ? "EDIT METHOD" : "NEW METHOD"}
        </div>
        <p className="text-xs mb-3" style={{ color: COLORS.inkSoft }}>
          The phase order here is fixed once saved — to try a different order, save it as a new method.
        </p>
        <Label COLORS={COLORS}>Method name</Label>
        <TextInput placeholder="e.g. Small-Sided Focus" value={name} onChange={(e) => setName(e.target.value)} COLORS={COLORS} />
        <div className="mt-3 space-y-2">
          <Label COLORS={COLORS}>Phases (in order)</Label>
          {phases.map((p, idx) => (
            <div key={p.id || idx} className="flex gap-2 items-start">
              <span
                className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                style={{ background: COLORS.amber, color: COLORS.ink, fontFamily: "JetBrains Mono" }}
              >
                {idx + 1}
              </span>
              <div className="flex-1 space-y-1.5">
                <TextInput placeholder="Phase label (e.g. Warm-up)" value={p.label} onChange={(e) => updatePhase(idx, { label: e.target.value })} COLORS={COLORS} />
                <Select value={p.defaultCategory} onChange={(v) => updatePhase(idx, { defaultCategory: v })} options={phaseCategoryOptions} COLORS={COLORS} />
              </div>
              {phases.length > 1 && (
                <button onClick={() => removePhase(idx)} className="mt-2">
                  <X size={15} color={COLORS.inkSoft} />
                </button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" icon={Plus} onClick={addPhase} COLORS={COLORS}>Add phase</Button>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" icon={Save} onClick={saveMethod} COLORS={COLORS}>
            {editingId ? "Save changes" : "Save method"}
          </Button>
          {editingId && <Button variant="subtle" onClick={resetForm} COLORS={COLORS}>Cancel</Button>}
        </div>
      </Card>
    </div>
  );
}

function MatchDayTab({ players, teams, formats, matchdays, persistPlayers, persistTeams, persistFormats, persistMatchdays, flash, COLORS }) {
  const [sub, setSub] = useState("matchdays");
  const subTabs = [
    { id: "matchdays", label: "Match Days" },
    { id: "squad", label: "Squad" },
    { id: "formats", label: "Formats" },
  ];

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className="px-3.5 py-1.5 text-sm font-semibold rounded-full"
            style={{
              background: sub === t.id ? COLORS.pitch : COLORS.chalkDim,
              color: sub === t.id ? "#fff" : COLORS.ink,
              fontFamily: "Inter",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === "matchdays" && (
        <MatchDaysView
          players={players}
          teams={teams}
          formats={formats}
          matchdays={matchdays}
          persistPlayers={persistPlayers}
          persistMatchdays={persistMatchdays}
          flash={flash}
          COLORS={COLORS}
        />
      )}
      {sub === "squad" && (
        <SquadView players={players} teams={teams} matchdays={matchdays} persistPlayers={persistPlayers} persistTeams={persistTeams} flash={flash} COLORS={COLORS} />
      )}
      {sub === "formats" && (
        <FormatsView formats={formats} persistFormats={persistFormats} flash={flash} COLORS={COLORS} />
      )}
    </div>
  );
}

function TeamBadge({ team, size = 18 }) {
  const color = getTeamColor(team);
  const letter = (team || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      title={team}
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        background: color,
        color: "#fff",
        fontFamily: "Inter",
        fontWeight: 800,
        fontSize: size * 0.52,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

function TeamToggles({ teams, selected, onToggle, size = "sm", COLORS = DEFAULT_THEME.colors }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {teams.map((t) => {
        const on = selected.includes(t);
        const color = getTeamColor(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggle(t)}
            className={`flex items-center font-semibold rounded-full ${size === "sm" ? "gap-1 pl-1 pr-2.5 py-1 text-xs" : "gap-1.5 pl-1.5 pr-3 py-1.5 text-sm"}`}
            style={{
              background: on ? color : hexToRgba(color, 0.12),
              color: on ? "#fff" : COLORS.ink,
              border: `1.5px solid ${on ? color : hexToRgba(color, 0.4)}`,
            }}
          >
            <TeamBadge team={t} size={size === "sm" ? 15 : 18} />
            {t}
          </button>
        );
      })}
    </div>
  );
}

// Derives "games played" and "positions played" straight from the actual match day
// data (only counting games marked as played), rather than a separately-stored
// counter that can drift out of sync whenever a game is deleted or un-marked.
// Derives how many times each drill has actually been used, straight from
// completed sessions. The old stored `timesUsed` counter only ever incremented,
// so deleting a session left the count permanently inflated.
function computeDrillUsage(sessions) {
  const usage = {};
  (sessions || []).forEach((s) => {
    if (s.status !== "completed") return;
    const countedThisSession = new Set();
    (s.phases || []).forEach((p) => {
      if (!p.drillId || countedThisSession.has(p.drillId)) return;
      countedThisSession.add(p.drillId);
      usage[p.drillId] = (usage[p.drillId] || 0) + 1;
    });
  });
  return usage;
}

function computeDerivedPlayerStats(matchdays) {
  const stats = {};
  (matchdays || []).forEach((md) => {
    (md.games || []).forEach((game) => {
      if (!game.played) return;
      const playedThisGame = new Set();
      (game.intervals || []).forEach((iv) => {
        (iv.onField || []).forEach((of) => {
          if (!stats[of.playerId]) stats[of.playerId] = { gamesPlayed: 0, positionCounts: {} };
          stats[of.playerId].positionCounts[of.position] = (stats[of.playerId].positionCounts[of.position] || 0) + 1;
          playedThisGame.add(of.playerId);
        });
      });
      playedThisGame.forEach((playerId) => {
        if (!stats[playerId]) stats[playerId] = { gamesPlayed: 0, positionCounts: {} };
        stats[playerId].gamesPlayed += 1;
      });
    });
  });
  return stats;
}

function SquadView({ players, teams, matchdays, persistPlayers, persistTeams, flash, COLORS }) {
  const [name, setName] = useState("");
  const [selectedTeams, setSelectedTeams] = useState([SQUAD_TEAM]);
  const [bulk, setBulk] = useState("");
  const [bulkTeams, setBulkTeams] = useState([SQUAD_TEAM]);
  const [newTeam, setNewTeam] = useState("");
  const [teamFilter, setTeamFilter] = useState("All");
  const derivedStats = useMemo(() => computeDerivedPlayerStats(matchdays), [matchdays]);

  const toggleIn = (setter) => (t) =>
    setter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const addPlayer = async () => {
    if (!name.trim()) return flash("Give the player a name");
    const teamsForPlayer = selectedTeams.length ? selectedTeams : [SQUAD_TEAM];
    await persistPlayers([
      ...players,
      { id: uid(), name: name.trim(), teams: teamsForPlayer, gamesPlayed: 0, positionCounts: {}, rotationPointer: 0 },
    ]);
    setName("");
    flash("Player added");
  };

  const addBulk = async () => {
    const names = bulk.split("\n").map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    const teamsForPlayers = bulkTeams.length ? bulkTeams : [SQUAD_TEAM];
    const newPlayers = names.map((n) => ({ id: uid(), name: n, teams: teamsForPlayers, gamesPlayed: 0, positionCounts: {}, rotationPointer: 0 }));
    await persistPlayers([...players, ...newPlayers]);
    setBulk("");
    flash(`Added ${names.length} players`);
  };

  const removePlayer = async (id) => {
    await persistPlayers(players.filter((p) => p.id !== id));
    flash("Player removed");
  };

  const togglePlayerTeam = async (id, t) => {
    await persistPlayers(
      players.map((p) => {
        if (p.id !== id) return p;
        const has = p.teams.includes(t);
        const next = has ? p.teams.filter((x) => x !== t) : [...p.teams, t];
        return { ...p, teams: next.length ? next : [SQUAD_TEAM] };
      })
    );
  };

  const addTeam = async () => {
    const t = newTeam.trim();
    if (!t) return;
    if (teams.includes(t)) return flash("Team already exists");
    await persistTeams([...teams, t]);
    setNewTeam("");
    flash("Team added");
  };

  const removeTeam = async (t) => {
    if (t === SQUAD_TEAM) return flash(`Can't remove the ${SQUAD_TEAM} group`);
    if (players.some((p) => p.teams.includes(t))) return flash("Move players out of this team first");
    await persistTeams(teams.filter((x) => x !== t));
    flash("Team removed");
  };

  const shown = (teamFilter === "All" ? players : players.filter((p) => p.teams.includes(teamFilter)))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-5">
      <div className="space-y-4">
        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">TEAMS</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {teams.map((t) => (
              <div
                key={t}
                className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-full text-xs font-semibold"
                style={{ background: hexToRgba(getTeamColor(t), 0.12), color: COLORS.ink, border: `1.5px solid ${hexToRgba(getTeamColor(t), 0.4)}` }}
              >
                <TeamBadge team={t} size={16} />
                {t}
                {t !== SQUAD_TEAM && (
                  <button onClick={() => removeTeam(t)}><X size={12} color={COLORS.inkSoft} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <TextInput placeholder="e.g. Team A" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} COLORS={COLORS} />
            <Button variant="dark" icon={Plus} onClick={addTeam} COLORS={COLORS}>Add</Button>
          </div>
        </Card>

        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">ADD A PLAYER</div>
          <div className="space-y-2">
            <TextInput placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} COLORS={COLORS} />
            <Label COLORS={COLORS}>Teams</Label>
            <TeamToggles teams={teams} selected={selectedTeams} onToggle={toggleIn(setSelectedTeams)} COLORS={COLORS} />
            <Button variant="primary" icon={UserPlus} onClick={addPlayer} COLORS={COLORS}>Add player</Button>
          </div>
        </Card>

        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">BULK ADD</div>
          <p className="text-xs mb-2" style={{ color: COLORS.inkSoft }}>One name per line.</p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={5}
            placeholder={"Jack\nOllie\nFreddie…"}
            className="w-full text-sm rounded-lg px-2.5 py-2 border outline-none resize-none mb-2"
            style={{ borderColor: "#D9D3C1" }}
          />
          <Label COLORS={COLORS}>Teams</Label>
          <div className="mb-2">
            <TeamToggles teams={teams} selected={bulkTeams} onToggle={toggleIn(setBulkTeams)} COLORS={COLORS} />
          </div>
          <Button variant="dark" icon={UserPlus} onClick={addBulk} COLORS={COLORS}>Add all</Button>
        </Card>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          {["All", ...teams].map((t) => {
            const on = teamFilter === t;
            const color = t === "All" ? COLORS.pitch : getTeamColor(t);
            return (
              <button
                key={t}
                onClick={() => setTeamFilter(t)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap"
                style={{ background: on ? color : hexToRgba(color, 0.12), color: on ? "#fff" : COLORS.ink }}
              >
                {t !== "All" && <TeamBadge team={t} size={14} />}
                {t}
              </button>
            );
          })}
        </div>
        <p className="text-xs mb-2" style={{ color: COLORS.inkSoft }}>
          {shown.length} player{shown.length === 1 ? "" : "s"} {teamFilter === "All" ? "in the squad" : `in ${teamFilter}`}
        </p>
        <div className="space-y-2">
          {shown.map((p) => {
            const derived = derivedStats[p.id] || { gamesPlayed: 0, positionCounts: {} };
            return (
            <Card key={p.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-[120px]">
                <div className="text-sm font-bold" style={{ color: COLORS.ink }}>{p.name}</div>
                <div className="text-[11px]" style={{ color: COLORS.inkSoft }}>
                  {derived.gamesPlayed} games played
                  {Object.keys(derived.positionCounts).length > 0 && (
                    <> · {Object.entries(derived.positionCounts).map(([k, v]) => `${k} ${v}`).join(", ")}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex flex-wrap gap-1 items-center">
                  {teams.map((t) => {
                    const on = p.teams.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => togglePlayerTeam(p.id, t)}
                        title={t}
                        className="transition-transform active:scale-95"
                        style={{ opacity: on ? 1 : 0.25 }}
                      >
                        <TeamBadge team={t} size={22} />
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => removePlayer(p.id)} className="ml-1"><Trash2 size={15} color={COLORS.danger} /></button>
              </div>
            </Card>
          );})}
          {shown.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: COLORS.inkSoft }}>No players here yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FormatsView({ formats, persistFormats, flash, COLORS }) {
  const [playersPerSide, setPlayersPerSide] = useState(4);
  const [counts, setCounts] = useState({});
  const [editingId, setEditingId] = useState(null);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = playersPerSide - total;

  const resetForm = () => {
    setPlayersPerSide(4);
    setCounts({});
    setEditingId(null);
  };

  const startEdit = (f) => {
    setEditingId(f.id);
    setPlayersPerSide(f.positions.length);
    const c = {};
    f.positions.forEach((code) => { c[code] = (c[code] || 0) + 1; });
    setCounts(c);
  };

  const bump = (code, delta) => {
    setCounts((prev) => {
      const current = prev[code] || 0;
      const next = Math.max(0, current + delta);
      if (delta > 0 && remaining <= 0) return prev;
      return { ...prev, [code]: next };
    });
  };

  const buildPositions = () =>
    POSITION_LIBRARY.flatMap((pos) => Array((counts[pos.code] || 0)).fill(pos.code));

  const saveFormat = async () => {
    if (total !== playersPerSide) return flash(`Select exactly ${playersPerSide} positions (${total} chosen so far)`);
    const positions = buildPositions();
    let shapeName = formationShapeName(positions);
    const clashes = formats.filter(
      (f) => f.id !== editingId && f.positions.length === playersPerSide && f.name === shapeName
    );
    if (clashes.length) shapeName = `${shapeName} (${clashes.length + 1})`;

    if (editingId) {
      await persistFormats(formats.map((f) => (f.id === editingId ? { ...f, name: shapeName, positions } : f)));
      flash("Format updated");
    } else {
      await persistFormats([...formats, { id: uid(), name: shapeName, positions }]);
      flash(`Format added — ${playersPerSide}v${playersPerSide} · ${shapeName}`);
    }
    resetForm();
  };

  const deleteFormat = async (id) => {
    await persistFormats(formats.filter((f) => f.id !== id));
    if (editingId === id) resetForm();
    flash("Format deleted");
  };

  const grouped = useMemo(() => {
    const map = {};
    formats.forEach((f) => {
      const n = f.positions.length;
      if (!map[n]) map[n] = [];
      map[n].push(f);
    });
    return Object.entries(map).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [formats]);

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5">
      <div className="space-y-4">
        {grouped.map(([n, list]) => (
          <div key={n}>
            <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-lg mb-2">
              {n}v{n}
            </div>
            <div className="space-y-2">
              {list.map((f) => (
                <Card key={f.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Pill tone="amber" COLORS={COLORS}>{f.name}</Pill>
                    <div className="flex items-center gap-2">
                      <button onClick={() => startEdit(f)} title="Edit format"><Edit3 size={15} color={COLORS.inkSoft} /></button>
                      <button onClick={() => deleteFormat(f.id)} title="Delete format"><Trash2 size={15} color={COLORS.danger} /></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.positions.map((p, i) => <Pill key={i} tone="chalk" COLORS={COLORS}>{p}</Pill>)}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
        {formats.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-sm" style={{ color: COLORS.inkSoft }}>No formats yet — as you progress from 4v4 up to 11v11, add each one here.</p>
          </Card>
        )}
      </div>

      <Card className="p-4 h-fit">
        <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">
          {editingId ? "EDIT FORMAT" : "NEW FORMAT"}
        </div>
        <Label COLORS={COLORS}>Number of players per side</Label>
        <Select
          value={String(playersPerSide)}
          onChange={(v) => { setPlayersPerSide(Number(v)); setCounts({}); }}
          options={Array.from({ length: 9 }, (_, i) => i + 3).map((n) => ({ value: String(n), label: `${n}v${n}` }))}
          COLORS={COLORS}
        />
        <p className="text-xs mt-2 mb-2 font-semibold" style={{ color: remaining === 0 ? COLORS.pitch : COLORS.amberDeep }}>
          {total} of {playersPerSide} positions selected
        </p>
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {POSITION_LIBRARY.map((pos) => {
            const c = counts[pos.code] || 0;
            return (
              <div
                key={pos.code}
                className="flex items-center justify-between rounded-lg px-2.5 py-1.5"
                style={{ background: c > 0 ? "#FBE9C8" : COLORS.chalkDim }}
              >
                <div>
                  <span className="text-sm font-bold" style={{ color: COLORS.ink }}>{pos.code}</span>
                  <span className="text-xs ml-1.5" style={{ color: COLORS.inkSoft }}>{pos.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => bump(pos.code, -1)}
                    disabled={c === 0}
                    className="h-6 w-6 rounded-full flex items-center justify-center font-bold disabled:opacity-30"
                    style={{ background: "#fff", color: COLORS.ink, border: "1px solid #D9D3C1" }}
                  >
                    −
                  </button>
                  <span className="text-sm font-bold w-4 text-center" style={{ color: COLORS.ink, fontFamily: "JetBrains Mono" }}>{c}</span>
                  <button
                    onClick={() => bump(pos.code, 1)}
                    disabled={remaining <= 0}
                    className="h-6 w-6 rounded-full flex items-center justify-center font-bold disabled:opacity-30"
                    style={{ background: COLORS.amber, color: COLORS.ink }}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" icon={Save} onClick={saveFormat} COLORS={COLORS}>{editingId ? "Save changes" : "Save format"}</Button>
          {editingId && <Button variant="subtle" onClick={resetForm} COLORS={COLORS}>Cancel</Button>}
        </div>
      </Card>
    </div>
  );
}

function MatchDaysView({ players, teams, formats, matchdays, persistPlayers, persistMatchdays, flash, COLORS }) {
  const [date, setDate] = useState(todayStr());
  const [teamFilter, setTeamFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const eligible = (teamFilter === "All" ? players : players.filter((p) => p.teams.includes(teamFilter)))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const toggleSelect = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const createMatchDay = async () => {
    if (!selectedIds.length) return flash("Select who's present today");
    const md = { id: uid(), date, teamFilter, presentPlayerIds: selectedIds, games: [] };
    await persistMatchdays([md, ...matchdays]);
    setSelectedIds([]);
    flash("Match day created — generate your rotation plan below");
  };

  const deleteMatchDay = async (id) => {
    await persistMatchdays(matchdays.filter((m) => m.id !== id));
    flash("Match day deleted");
  };

  const handleUpdateMatchday = async (updatedMatchday) => {
    const updated = matchdays.map((md) => (md.id === updatedMatchday.id ? updatedMatchday : md));
    await persistMatchdays(updated);
  };

  const isMatchdayComplete = (md) => (md.games || []).length > 0 && md.games.every((g) => g.played);
  const sortedMatchdays = [...matchdays].sort((a, b) => b.date.localeCompare(a.date));
  const currentMatchdays = sortedMatchdays.filter((md) => !isMatchdayComplete(md));
  const historyMatchdays = sortedMatchdays.filter((md) => isMatchdayComplete(md));

  if (!players.length) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm" style={{ color: COLORS.inkSoft }}>Add your squad in the Squad tab before setting up a Match Day.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-5">
        <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-xl mb-3">CREATE NEW MATCHDAY</div>
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div>
            <Label COLORS={COLORS}>Date</Label>
            <div className="max-w-[170px]">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} COLORS={COLORS} />
            </div>
          </div>
          <div>
            <Label COLORS={COLORS}>Filter Squad Group</Label>
            <Select
              value={teamFilter}
              onChange={(v) => { setTeamFilter(v); setSelectedIds([]); }}
              options={["All", ...teams].map((t) => ({ value: t, label: t }))}
              COLORS={COLORS}
            />
          </div>
        </div>

        <Label COLORS={COLORS}>Select Present Players ({selectedIds.length})</Label>
        <div className="flex flex-wrap gap-2 mb-4">
          {eligible.map((p) => {
            const isSelected = selectedIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggleSelect(p.id)}
                className="px-3 py-1.5 text-xs font-semibold rounded-full border transition-all"
                style={{
                  background: isSelected ? COLORS.pitch : COLORS.chalkDim,
                  color: isSelected ? "#fff" : COLORS.ink,
                  borderColor: isSelected ? COLORS.pitch : "#D9D3C1"
                }}
              >
                {p.name} {isSelected && "✓"}
              </button>
            );
          })}
        </div>

        <Button variant="primary" icon={Plus} onClick={createMatchDay} COLORS={COLORS}>
          Create Matchday
        </Button>
      </Card>

      {/* Active match days */}
      <div>
        {currentMatchdays.map((md) => (
          <MatchDayCard
            key={md.id}
            matchday={md}
            roster={players}
            formats={formats}
            onUpdateMatchday={handleUpdateMatchday}
            onDelete={() => deleteMatchDay(md.id)}
            flash={flash}
            COLORS={COLORS}
          />
        ))}
        {currentMatchdays.length === 0 && historyMatchdays.length > 0 && (
          <p className="text-sm text-center py-6" style={{ color: COLORS.inkSoft }}>
            No active match days — everything's marked complete. See History below.
          </p>
        )}
      </div>

      {historyMatchdays.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center gap-2 p-3 rounded-lg"
            style={{ background: COLORS.chalkDim }}
          >
            {showHistory ? <ChevronDown size={16} color={COLORS.inkSoft} /> : <ChevronRight size={16} color={COLORS.inkSoft} />}
            <span style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-lg">
              HISTORY ({historyMatchdays.length})
            </span>
          </button>
          {showHistory && (
            <div className="mt-3">
              {historyMatchdays.map((md) => (
                <MatchDayCard
                  key={md.id}
                  matchday={md}
                  roster={players}
                  formats={formats}
                  onUpdateMatchday={handleUpdateMatchday}
                  onDelete={() => deleteMatchDay(md.id)}
                  flash={flash}
                  COLORS={COLORS}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThemeModal({ customThemes, activeThemeId, onSelectTheme, onAddTheme, onRemoveTheme, onClose, tabOrder, onReorderTabs, COLORS }) {
  const [themeName, setThemeName] = useState("");
  const [colors, setColors] = useState({
    pitch: "#1F4B3F",
    pitchLight: "#2D6A4F",
    pitchLighter: "#3B8362",
    chalk: "#F7F5EF",
    chalkDim: "#EDE9DE",
    amber: "#E8A33D",
    amberDeep: "#C97F1E",
    ink: "#16232B",
    inkSoft: "#4B5C58",
    danger: "#C0433A",
    line: "#FFFFFF",
  });

  const handleCreate = () => {
    if (!themeName.trim()) return;
    const newTheme = {
      id: `theme_${Date.now()}`,
      name: themeName.trim(),
      colors: { ...colors }
    };
    onAddTheme(newTheme);
  };

  const moveTab = (index, delta) => {
    const next = [...tabOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorderTabs(next);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="max-w-xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-2xl">Visual Theme Manager</h2>
          <button onClick={onClose}><X size={20} color={COLORS.inkSoft} /></button>
        </div>

        {/* Tab Order */}
        <div>
          <Label COLORS={COLORS}>Tab Order</Label>
          <div className="space-y-1.5 mt-1">
            {tabOrder.map((tabId, idx) => {
              const def = DEFAULT_TAB_DEFS.find((t) => t.id === tabId);
              if (!def) return null;
              const Icon = def.icon;
              return (
                <div key={tabId} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: COLORS.chalkDim }}>
                  <GripVertical size={14} color={COLORS.inkSoft} />
                  <Icon size={14} color={COLORS.pitch} />
                  <span className="text-sm font-semibold flex-1" style={{ color: COLORS.ink }}>{def.label}</span>
                  <button
                    onClick={() => moveTab(idx, -1)}
                    disabled={idx === 0}
                    className="w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25"
                    style={{ background: "#fff", border: "1px solid #D9D3C1" }}
                  >
                    <ChevronDown size={13} color={COLORS.ink} style={{ transform: "rotate(180deg)" }} />
                  </button>
                  <button
                    onClick={() => moveTab(idx, 1)}
                    disabled={idx === tabOrder.length - 1}
                    className="w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25"
                    style={{ background: "#fff", border: "1px solid #D9D3C1" }}
                  >
                    <ChevronDown size={13} color={COLORS.ink} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Saved Themes Selection */}
        <div>
          <Label COLORS={COLORS}>Presets & Custom Themes</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {customThemes.map((t) => {
              const isSelected = t.id === activeThemeId;
              const isSystem = BASE_THEMES.some((b) => b.id === t.id);
              return (
                <div
                  key={t.id}
                  className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer ${isSelected ? 'ring-2' : ''}`}
                  style={{
                    borderColor: isSelected ? COLORS.amber : "#D9D3C1",
                    background: t.colors.chalk
                  }}
                  onClick={() => onSelectTheme(t.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full" style={{ background: t.colors.pitch }} />
                    <span className="text-xs font-bold" style={{ color: t.colors.ink }}>{t.name}</span>
                  </div>
                  {!isSystem && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveTheme(t.id); }}
                      className="text-red-500 hover:text-red-700 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Custom Theme Creator */}
        <div className="border-t pt-4 space-y-3">
          <Label COLORS={COLORS}>Create Custom Palette</Label>
          <TextInput
            placeholder="Theme Name (e.g. Sunset Gold)"
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            COLORS={COLORS}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {Object.entries(colors).map(([key, val]) => (
              <div key={key} className="space-y-1">
                <span className="text-[10px] uppercase font-semibold text-gray-500">{key}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={val}
                    onChange={(e) => setColors({ ...colors, [key]: e.target.value })}
                    className="w-8 h-8 rounded border cursor-pointer p-0"
                  />
                  <span className="font-mono text-[10px]">{val}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="subtle" onClick={onClose} COLORS={COLORS}>Cancel</Button>
            <Button variant="primary" icon={Plus} onClick={handleCreate} COLORS={COLORS}>Save Theme</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}