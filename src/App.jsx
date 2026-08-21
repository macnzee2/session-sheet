import React, { useState } from 'react';

// --- HELPER CONSTANTS ---
const FORMATS = {
  '5v5': { label: '5v5', positions: ['GK', 'DEF-L', 'DEF-R', 'MID', 'FWD'] },
  '7v7': { label: '7v7', positions: ['GK', 'DEF-L', 'DEF-C', 'DEF-R', 'MID-L', 'MID-R', 'FWD'] },
  '9v9': { label: '9v9', positions: ['GK', 'DEF-L', 'DEF-CL', 'DEF-CR', 'DEF-R', 'MID-L', 'MID-R', 'FWD-L', 'FWD-R'] },
  '11v11': { label: '11v11', positions: ['GK', 'DEF-LB', 'DEF-CB1', 'DEF-CB2', 'DEF-RB', 'MID-LM', 'MID-CM1', 'MID-CM2', 'MID-RM', 'FWD-ST1', 'FWD-ST2'] }
};

// FAIR POSITION ROTATION (SINGLE-DAY MATCHDAY SCOPE)
function generateRotationPlan(presentPlayers, format, duration, subInterval, existingMatchdayGames = []) {
  const requiredPositions = format.positions; 
  const P = requiredPositions.length;
  const N = presentPlayers.length;
  if (N < P) return null; // Need at least enough players to fill the pitch
  
  const g = N - P;
  const numIntervals = g === 0 ? 1 : Math.max(1, Math.ceil(duration / subInterval));
  
  // 1. Build a local position tracker purely from TODAY'S games generated so far
  const todayPositionCounts = {};
  presentPlayers.forEach((p) => {
    todayPositionCounts[p.id] = {};
  });

  // Tally positions played earlier TODAY (ignoring past weeks)
  existingMatchdayGames.forEach((game) => {
    game.intervals?.forEach((iv) => {
      iv.onField?.forEach((of) => {
        if (todayPositionCounts[of.playerId]) {
          const pos = of.position;
          todayPositionCounts[of.playerId][pos] = (todayPositionCounts[of.playerId][pos] || 0) + 1;
        }
      });
    });
  });

  const intervals = [];

  // 2. Generate intervals for the CURRENT game
  for (let i = 0; i < numIntervals; i++) {
    const startMin = i === 0 ? 0 : Math.round(i * subInterval * 10) / 10;
    const endMin = Math.round(Math.min(duration, (i + 1) * subInterval) * 10) / 10;
    
    // Select bench players sequentially for this game
    const benchedIdxs = new Set();
    if (g > 0) {
      const startIndex = (i * g) % N;
      for (let k = 0; k < g; k++) benchedIdxs.add((startIndex + k) % N);
    }

    const benched = [];
    const activePlayers = [];

    presentPlayers.forEach((p, idx) => {
      if (benchedIdxs.has(idx)) {
        benched.push(p.id);
      } else {
        activePlayers.push(p);
      }
    });

    // 3. Assign positions prioritizing positions the player has played LEAST TODAY
    const onField = [];
    const availablePositions = [...requiredPositions];

    activePlayers.forEach((player) => {
      // Respect fixed manual overrides if specified (e.g., dedicated GK)
      if (player.preferredPosition && availablePositions.includes(player.preferredPosition)) {
        const posIndex = availablePositions.indexOf(player.preferredPosition);
        const assignedPos = availablePositions.splice(posIndex, 1)[0];
        
        todayPositionCounts[player.id][assignedPos] = (todayPositionCounts[player.id][assignedPos] || 0) + 1;
        onField.push({ playerId: player.id, position: assignedPos });
        return;
      }

      // Otherwise, sort available positions by what this player has done LEAST today
      availablePositions.sort((a, b) => {
        const countA = todayPositionCounts[player.id][a] || 0;
        const countB = todayPositionCounts[player.id][b] || 0;
        return countA - countB;
      });

      const assignedPos = availablePositions.shift();
      
      // Update local count for the next interval calculation
      todayPositionCounts[player.id][assignedPos] = (todayPositionCounts[player.id][assignedPos] || 0) + 1;

      onField.push({ playerId: player.id, position: assignedPos });
    });

    intervals.push({ index: i, startMin, endMin, onField, benched });
  }

  return { intervals };
}

// --- MATCHDAY CARD COMPONENT ---
function MatchDayCard({ matchday, roster, onUpdateMatchday }) {
  const [numGamesToAdd, setNumGamesToAdd] = useState(1);
  const [selectedFormat, setSelectedFormat] = useState('7v7');
  const [gameDuration, setGameDuration] = useState(20);
  const [subInterval, setSubInterval] = useState(5);

  const presentPlayers = roster.filter((p) => matchday.attendance?.[p.id] === 'present');

  const addGames = () => {
    const format = FORMATS[selectedFormat];
    const newGames = [];

    for (let i = 0; i < numGamesToAdd; i++) {
      const plan = generateRotationPlan(
        presentPlayers,
        format,
        Number(gameDuration),
        Number(subInterval),
        [...matchday.games, ...newGames]
      );

      if (!plan) {
        alert(`Need at least ${format.positions.length} present players for ${format.label}.`);
        return;
      }

      newGames.push({
        id: `g_${Date.now()}_${i}`,
        formatKey: selectedFormat,
        duration: Number(gameDuration),
        subInterval: Number(subInterval),
        intervals: plan.intervals
      });
    }

    onUpdateMatchday({
      ...matchday,
      games: [...matchday.games, ...newGames]
    });
  };

  const regenerateGame = (gameId) => {
    const game = matchday.games.find((g) => g.id === gameId);
    if (!game) return;

    const fmt = FORMATS[game.formatKey];
    const plan = generateRotationPlan(
      presentPlayers,
      fmt,
      game.duration,
      game.subInterval,
      matchday.games.filter((g) => g.id !== gameId)
    );

    if (!plan) return;

    const updatedGames = matchday.games.map((g) => (g.id === gameId ? { ...g, intervals: plan.intervals } : g));
    onUpdateMatchday({ ...matchday, games: updatedGames });
  };

  const toggleAttendance = (playerId) => {
    const currentStatus = matchday.attendance?.[playerId] || 'absent';
    const nextStatus = currentStatus === 'present' ? 'absent' : 'present';

    onUpdateMatchday({
      ...matchday,
      attendance: {
        ...matchday.attendance,
        [playerId]: nextStatus
      }
    });
  };

  return (
    <div style={{ border: '1px solid #ccc', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
      <h2>Matchday: {matchday.date}</h2>

      {/* Attendance Tracker */}
      <div style={{ marginBottom: '16px' }}>
        <h3>Attendance</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {roster.map((player) => {
            const isPresent = matchday.attendance?.[player.id] === 'present';
            return (
              <button
                key={player.id}
                onClick={() => toggleAttendance(player.id)}
                style={{
                  padding: '6px 12px',
                  backgroundColor: isPresent ? '#4CAF50' : '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {player.name} ({isPresent ? 'Present' : 'Absent'})
              </button>
            );
          })}
        </div>
      </div>

      {/* Game Generation Controls */}
      <div style={{ borderTop: '1px solid #eee', paddingTop: '16px', marginBottom: '16px' }}>
        <h3>Add Games</h3>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            Format:
            <select value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)}>
              {Object.keys(FORMATS).map((k) => (
                <option key={k} value={k}>{FORMATS[k].label}</option>
              ))}
            </select>
          </label>

          <label>
            Duration (mins):
            <input
              type="number"
              value={gameDuration}
              onChange={(e) => setGameDuration(e.target.value)}
              style={{ width: '60px' }}
            />
          </label>

          <label>
            Sub Interval (mins):
            <input
              type="number"
              value={subInterval}
              onChange={(e) => setSubInterval(e.target.value)}
              style={{ width: '60px' }}
            />
          </label>

          <label>
            Number of Games:
            <input
              type="number"
              value={numGamesToAdd}
              onChange={(e) => setNumGamesToAdd(e.target.value)}
              style={{ width: '60px' }}
            />
          </label>

          <button onClick={addGames} style={{ padding: '6px 16px', cursor: 'pointer' }}>Generate Games</button>
        </div>
      </div>

      {/* Matchday Schedule Display */}
      <div>
        <h3>Schedule ({matchday.games.length} Games)</h3>
        {matchday.games.map((game, gIdx) => (
          <div key={game.id} style={{ backgroundColor: '#f9f9f9', padding: '12px', marginBottom: '12px', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4>Game {gIdx + 1} ({game.formatKey} - {game.duration} mins)</h4>
              <button onClick={() => regenerateGame(game.id)}>Reshuffle Game</button>
            </div>

            {game.intervals.map((iv) => (
              <div key={iv.index} style={{ marginTop: '8px', paddingLeft: '8px', borderLeft: '2px solid #007bff' }}>
                <strong>{iv.startMin}' - {iv.endMin}'</strong>
                <ul>
                  {iv.onField.map((of) => {
                    const p = roster.find((r) => r.id === of.playerId);
                    return <li key={of.playerId}>{p?.name || of.playerId}: <strong>{of.position}</strong></li>;
                  })}
                </ul>
                {iv.benched.length > 0 && (
                  <p style={{ color: '#666', fontSize: '0.9em' }}>
                    Bench: {iv.benched.map((bId) => roster.find((r) => r.id === bId)?.name || bId).join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- MAIN MATCHDAYS VIEW TAB ---
export default function MatchDaysView() {
  const [roster] = useState([
    { id: 'p1', name: 'Alex' },
    { id: 'p2', name: 'Ben' },
    { id: 'p3', name: 'Charlie' },
    { id: 'p4', name: 'David' },
    { id: 'p5', name: 'Ethan' },
    { id: 'p6', name: 'Frank' },
    { id: 'p7', name: 'George' },
    { id: 'p8', name: 'Harry' }
  ]);

  const [matchdays, setMatchdays] = useState([
    {
      id: 'md_1',
      date: '2026-08-22',
      attendance: { p1: 'present', p2: 'present', p3: 'present', p4: 'present', p5: 'present', p6: 'present', p7: 'present', p8: 'present' },
      games: []
    }
  ]);

  const handleUpdateMatchday = (updatedMatchday) => {
    setMatchdays(matchdays.map((md) => (md.id === updatedMatchday.id ? updatedMatchday : md)));
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <h1>Matchday Manager</h1>
      {matchdays.map((matchday) => (
        <MatchDayCard
          key={matchday.id}
          matchday={matchday}
          roster={roster}
          onUpdateMatchday={handleUpdateMatchday}
        />
      ))}
    </div>
  );
}