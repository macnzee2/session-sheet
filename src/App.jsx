import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Trash2, Star, Shuffle, Calendar, BookOpen, Layers,
  CheckCircle2, Circle, X, ChevronDown, ChevronRight,
  Save, ClipboardList, Users, Edit3, UserPlus, Repeat
} from "lucide-react";
import { supabase } from "./supabaseClient";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap');`;

const COLORS = {
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
};

// ✅ FIX: Use native crypto.randomUUID() for valid PostgreSQL UUIDs
const uid = () => crypto.randomUUID();
const todayStr = () => new Date().toISOString().slice(0, 10);

const THEME_CATEGORIES = ["Shooting", "Passing", "Dribbling", "Defending"];
const FULL_GAME = "Full Game";
const CONDITIONAL_GAME = "Conditional Game";
const THEME_MARKER = "Theme"; // pseudo-category: phase resolves to whichever theme is selected

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
  { positions: ["DEF", "LW", "RW", "ST"] },
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
    drills, methods, categories: DEFAULT_CATEGORIES, sessions: [], ratings: [],
    players: [], teams: DEFAULT_TEAMS, formats, matchdays: [],
  };
}

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

// ---------- SUPABASE DATA LAYER ----------
const FIELD_MAP = {
  drills: { timesUsed: "times_used" },
  sessions: { methodId: "method_id", methodName: "method_name" },
  ratings: { sessionId: "session_id", drillId: "drill_id" },
  players: { gamesPlayed: "games_played", positionCounts: "position_counts", rotationPointer: "rotation_pointer" },
  matchdays: { teamFilter: "team_filter", presentPlayerIds: "present_player_ids" },
};
const ROW_TABLES = ["drills", "methods", "sessions", "ratings", "players", "formats", "matchdays"];
const NAME_TABLES = ["categories", "teams"];

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
    await supabase.from(table).upsert(rows.map((name) => ({ name })));
    return;
  }
  if (!rows.length) return;
  await supabase.from(table).upsert(rows.map((r) => toRow(table, r)));
}

async function syncRowTable(table, prevList, nextList) {
  const prevIds = new Set(prevList.map((x) => x.id));
  const nextIds = new Set(nextList.map((x) => x.id));
  const toDelete = prevList.filter((x) => !nextIds.has(x.id)).map((x) => x.id);
  if (toDelete.length) {
    await supabase.from(table).delete().in("id", toDelete);
  }
  if (nextList.length) {
    await supabase.from(table).upsert(nextList.map((r) => toRow(table, r)));
  }
}
async function syncNameTable(table, prevList, nextList) {
  const nextSet = new Set(nextList);
  const toDelete = prevList.filter((x) => !nextSet.has(x));
  if (toDelete.length) {
    await supabase.from(table).delete().in("name", toDelete);
  }
  if (nextList.length) {
    await supabase.from(table).upsert(nextList.map((name) => ({ name })));
  }
}

function useRefValue(value) {
  const ref = React.useRef(value);
  useEffect(() => { ref.current = value; }, [value]);
  return ref;
}

function Pill({ children, tone = "pitch" }) {
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

function StarRating({ value, onChange, size = 16, readOnly = false }) {
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

function Button({ children, onClick, variant = "primary", size = "md", icon: Icon, disabled, type = "button", title }) {
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

function Select({ value, onChange, options, placeholder }) {
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
  return (
    <input
      {...props}
      className={`w-full text-sm rounded-lg px-2.5 py-2 border outline-none ${props.className || ""}`}
      style={{ fontFamily: "Inter", borderColor: "#D9D3C1", color: COLORS.ink, ...(props.style || {}) }}
    />
  );
}

function Label({ children }) {
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
  const [sessions, setSessions] = useState([]);
  const [ratings, setRatings] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [formats, setFormats] = useState([]);
  const [matchdays, setMatchdays] = useState([]);
  const [tab, setTab] = useState("plan");
  const [toast, setToast] = useState(null);
  const [connectionWarning, setConnectionWarning] = useState(false);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), msg && msg.length > 60 ? 5000 : 2200);
  };

  useEffect(() => {
    (async () => {
      const [d, m, c, s, r, pl, tm, fm, md] = await Promise.all([
        fetchTable("drills"), fetchTable("methods"), fetchTable("categories"),
        fetchTable("sessions"), fetchTable("ratings"), fetchTable("players"),
        fetchTable("teams"), fetchTable("formats"), fetchTable("matchdays"),
      ]);

      if ([d, m, c, s, r, pl, tm, fm, md].some((x) => x === null)) {
        setConnectionWarning(true);
        setLoading(false);
        return;
      }

      let finalDrills = d, finalMethods = m, finalCategories = c, finalFormats = fm, finalTeams = tm;
      if (!d.length && !m.length && !c.length && !fm.length) {
        const seed = seedData();
        finalDrills = seed.drills;
        finalMethods = seed.methods;
        finalCategories = seed.categories;
        finalFormats = seed.formats;
        finalTeams = seed.teams;
        await Promise.all([
          seedTable("categories", finalCategories),
          seedTable("teams", finalTeams),
          seedTable("drills", finalDrills),
          seedTable("methods", finalMethods),
          seedTable("formats", finalFormats),
        ]);
      }

      setDrills(finalDrills);
      setMethods(finalMethods);
      setCategories(finalCategories);
      setSessions(s);
      setRatings(r);
      setPlayers(normalizePlayers(pl));
      setTeams(normalizeTeams(finalTeams.length ? finalTeams : DEFAULT_TEAMS));
      setFormats(finalFormats);
      setMatchdays(md);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const setters = {
      drills: setDrills, methods: setMethods, sessions: setSessions, ratings: setRatings,
      players: (v) => setPlayers(normalizePlayers(v)), formats: setFormats, matchdays: setMatchdays,
      categories: setCategories, teams: (v) => setTeams(normalizeTeams(v)),
    };
    const channel = supabase.channel("session-sheet-changes");
    [...ROW_TABLES, ...NAME_TABLES].forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, async () => {
        const fresh = await fetchTable(table);
        if (fresh !== null) setters[table](fresh);
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
  const categoriesRef = useRefValue(categories);
  const teamsRef = useRefValue(teams);

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
  const persistCategories = useCallback(async (next) => {
    setCategories(next);
    await syncNameTable("categories", categoriesRef.current, next);
  }, []);
  const persistTeams = useCallback(async (next) => {
    setTeams(next);
    await syncNameTable("teams", teamsRef.current, next);
  }, []);

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
    <div style={{ background: COLORS.chalk, fontFamily: "Inter" }} className="rounded-xl overflow-hidden">
      <style>{FONT_IMPORT}</style>
      <Header tab={tab} setTab={setTab} />
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
            sessions={sessions}
            persistSessions={persistSessions}
            avgRating={avgRating}
            flash={flash}
          />
        )}
        {tab === "history" && (
          <HistoryTab
            sessions={sessions}
            drills={drills}
            persistSessions={persistSessions}
            persistDrills={persistDrills}
            ratings={ratings}
            persistRatings={persistRatings}
            flash={flash}
          />
        )}
        {tab === "drills" && (
          <DrillsTab
            drills={drills}
            categories={categories}
            persistDrills={persistDrills}
            persistCategories={persistCategories}
            avgRating={avgRating}
            flash={flash}
          />
        )}
        {tab === "methods" && (
          <MethodsTab
            methods={methods}
            categories={categories}
            persistMethods={persistMethods}
            flash={flash}
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
          />
        )}
      </div>
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

function Header({ tab, setTab }) {
  const tabs = [
    { id: "plan", label: "Plan Session", icon: ClipboardList },
    { id: "history", label: "History", icon: Calendar },
    { id: "drills", label: "Drills", icon: Layers },
    { id: "methods", label: "Methods", icon: BookOpen },
    { id: "matchday", label: "Match Day", icon: Users },
  ];
  return (
    <div style={{ background: COLORS.pitch }} className="relative px-4 sm:px-6 pt-5 pb-0 overflow-hidden">
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

function PlanTab({ methods, drills, drillsByCategory, sessions, persistSessions, avgRating, flash }) {
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [theme, setTheme] = useState(THEME_CATEGORIES[0]);
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
    const min = Math.min(...pool.map((d) => d.timesUsed || 0));
    const candidates = pool.filter((d) => (d.timesUsed || 0) === min);
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

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5">
      <div>
        <Card className="p-4 sm:p-5 mb-4">
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <Label>Date</Label>
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Coaching method</Label>
              <Select
                value={methodId}
                onChange={setMethodId}
                options={methods.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="Choose a method…"
              />
            </div>
          </div>
          <div>
            <Label>Session theme</Label>
            <div className="flex flex-wrap gap-2">
              {THEME_CATEGORIES.map((t) => (
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
              <Button variant="dark" icon={Shuffle} onClick={autoGenerate}>Auto-generate</Button>
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
                          <Pill tone="chalk">{s.category}</Pill>
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
                                label: `${d.name}${d.timesUsed ? ` · used ${d.timesUsed}×` : ""}`,
                              }))}
                              placeholder="Select a drill…"
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
              <Label>Session notes (optional)</Label>
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
              <Button variant="primary" size="lg" icon={Save} onClick={saveSession}>Save session</Button>
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-sm" style={{ color: COLORS.inkSoft }}>Choose a coaching method above to build your session.</p>
          </Card>
        )}
      </div>

      <div>
        <Card className="p-4 sm:p-5">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch, letterSpacing: 0.5 }} className="text-lg mb-3">
            UPCOMING
          </div>
          {sessions.filter((s) => s.status === "planned").length === 0 && (
            <p className="text-xs" style={{ color: COLORS.inkSoft }}>No planned sessions yet.</p>
          )}
          <div className="space-y-2">
            {sessions
              .filter((s) => s.status === "planned")
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 6)
              .map((s) => (
                <div key={s.id} className="rounded-lg p-2.5" style={{ background: COLORS.chalkDim }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{s.date}</span>
                    <Pill tone="pitch">{s.methodName}</Pill>
                  </div>
                  <p className="text-xs mt-1" style={{ color: COLORS.inkSoft }}>
                    {s.theme ? `Theme: ${s.theme} · ` : ""}{s.phases.map((p) => p.label).join(" → ")}
                  </p>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function HistoryTab({ sessions, drills, persistSessions, persistDrills, ratings, persistRatings, flash }) {
  const [expanded, setExpanded] = useState(null);
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

  const completeSession = async (session) => {
    const nextDrills = drills.map((d) => {
      const used = session.phases.some((p) => p.drillId === d.id);
      return used ? { ...d, timesUsed: (d.timesUsed || 0) + 1 } : d;
    });
    await persistDrills(nextDrills);
    const nextSessions = sessions.map((s) => (s.id === session.id ? { ...s, status: "completed" } : s));
    await persistSessions(nextSessions);
    flash("Marked complete — drill usage updated");
    setExpanded(session.id);
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

  const ratingFor = (session, drillId) =>
    ratings.find((r) => r.sessionId === session.id && r.drillId === drillId)?.value || 0;

  if (!sorted.length) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm" style={{ color: COLORS.inkSoft }}>No sessions yet — plan one in the Plan Session tab.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((s) => {
        const isOpen = expanded === s.id;
        return (
          <Card key={s.id} className="overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : s.id)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown size={16} color={COLORS.inkSoft} /> : <ChevronRight size={16} color={COLORS.inkSoft} />}
                <div>
                  <div className="text-sm font-bold" style={{ color: COLORS.ink, fontFamily: "Inter" }}>{s.date}</div>
                  <div className="text-xs" style={{ color: COLORS.inkSoft }}>
                    {s.methodName}{s.theme ? ` · ${s.theme}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.status === "completed" ? (
                  <Pill tone="pitch">Completed</Pill>
                ) : (
                  <Pill tone="amber">Planned</Pill>
                )}
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-4">
                <div className="space-y-2 mb-3">
                  {s.phases.map((p, idx) => {
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
                        {s.status === "completed" && drill && (
                          <StarRating value={ratingFor(s, drill.id)} onChange={(v) => rateDrill(s, drill.id, v)} />
                        )}
                      </div>
                    );
                  })}
                </div>
                {s.notes && (
                  <p className="text-xs mb-3 italic" style={{ color: COLORS.inkSoft }}>"{s.notes}"</p>
                )}
                <div className="flex items-center gap-2">
                  {s.status !== "completed" && (
                    <Button variant="dark" size="sm" icon={CheckCircle2} onClick={() => completeSession(s)}>
                      Mark complete
                    </Button>
                  )}
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => deleteSession(s.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function DrillsTab({ drills, categories, persistDrills, persistCategories, avgRating, flash }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [drillTheme, setDrillTheme] = useState("");
  const [description, setDescription] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [filter, setFilter] = useState("All");
  const [editingId, setEditingId] = useState(null);

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

  const addCategory = async () => {
    const c = newCategory.trim();
    if (!c) return;
    if (categories.includes(c)) return flash("Category already exists");
    await persistCategories([...categories, c]);
    setNewCategory("");
    flash("Category added");
  };

  const shown = filter === "All" ? drills : drills.filter((d) => d.category === filter);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-5">
      <div className="space-y-4">
        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">
            {editingId ? "EDIT DRILL" : "ADD A DRILL"}
          </div>
          <div className="space-y-2">
            <TextInput placeholder="Drill name" value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />
            {category === CONDITIONAL_GAME && (
              <Select
                value={drillTheme}
                onChange={setDrillTheme}
                options={THEME_CATEGORIES.map((t) => ({ value: t, label: t }))}
                placeholder="Which theme fits? (optional — works for any)"
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
              <Button variant="primary" icon={editingId ? Save : Plus} onClick={addDrill}>
                {editingId ? "Save changes" : "Add drill"}
              </Button>
              {editingId && (
                <Button variant="subtle" onClick={resetForm}>Cancel</Button>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">ADD A CATEGORY</div>
          <div className="flex gap-2">
            <TextInput placeholder="e.g. Goalkeeping" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
            <Button variant="dark" icon={Plus} onClick={addCategory}>Add</Button>
          </div>
        </Card>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          {["All", ...categories].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className="px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap"
              style={{
                background: filter === c ? COLORS.pitch : COLORS.chalkDim,
                color: filter === c ? "#fff" : COLORS.ink,
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {shown.map((d) => (
            <Card key={d.id} className="p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold" style={{ color: COLORS.ink }}>{d.name}</div>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    <Pill tone="chalk">{d.category}</Pill>
                    {d.theme && <Pill tone="amber">{d.theme}</Pill>}
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
                <p className="text-xs mt-2" style={{ color: COLORS.inkSoft }}>{d.description}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] font-mono" style={{ color: COLORS.inkSoft, fontFamily: "JetBrains Mono" }}>
                  Used {d.timesUsed || 0}×
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
    </div>
  );
}

function MethodsTab({ methods, categories, persistMethods, flash }) {
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
                  <Pill tone="chalk">{p.label} <span style={{ opacity: 0.6 }}>· {labelFor(p.defaultCategory)}</span></Pill>
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
        <Label>Method name</Label>
        <TextInput placeholder="e.g. Small-Sided Focus" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="mt-3 space-y-2">
          <Label>Phases (in order)</Label>
          {phases.map((p, idx) => (
            <div key={p.id || idx} className="flex gap-2 items-start">
              <span
                className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                style={{ background: COLORS.amber, color: COLORS.ink, fontFamily: "JetBrains Mono" }}
              >
                {idx + 1}
              </span>
              <div className="flex-1 space-y-1.5">
                <TextInput placeholder="Phase label (e.g. Warm-up)" value={p.label} onChange={(e) => updatePhase(idx, { label: e.target.value })} />
                <Select value={p.defaultCategory} onChange={(v) => updatePhase(idx, { defaultCategory: v })} options={phaseCategoryOptions} />
              </div>
              {phases.length > 1 && (
                <button onClick={() => removePhase(idx)} className="mt-2">
                  <X size={15} color={COLORS.inkSoft} />
                </button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" icon={Plus} onClick={addPhase}>Add phase</Button>
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" icon={Save} onClick={saveMethod}>
            {editingId ? "Save changes" : "Save method"}
          </Button>
          {editingId && <Button variant="subtle" onClick={resetForm}>Cancel</Button>}
        </div>
      </Card>
    </div>
  );
}

function suggestSubInterval(n, p) {
  const g = n - p;
  if (g <= 0) return 10;
  if (g === 1) return 2;
  if (g === 2) return 3.5;
  return Math.max(1, Math.round((10 / Math.max(1, Math.round(n / g))) * 2) / 2);
}

function generateRotationPlan(presentPlayers, format, duration, subInterval) {
  const P = format.positions.length;
  const N = presentPlayers.length;
  if (N < P) return null;
  const g = N - P;
  const numIntervals = g === 0 ? 1 : Math.max(1, Math.ceil(duration / subInterval));
  const pointers = {};
  presentPlayers.forEach((p) => { pointers[p.id] = p.rotationPointer || 0; });
  const intervals = [];
  for (let i = 0; i < numIntervals; i++) {
    const startMin = i === 0 ? 0 : Math.round(i * subInterval * 10) / 10;
    const endMin = Math.round(Math.min(duration, (i + 1) * subInterval) * 10) / 10;
    const benchedIdxs = new Set();
    if (g > 0) {
      const startIndex = (i * g) % N;
      for (let k = 0; k < g; k++) benchedIdxs.add((startIndex + k) % N);
    }
    const benched = [];
    const onField = [];
    presentPlayers.forEach((p, idx) => {
      if (benchedIdxs.has(idx)) {
        benched.push(p.id);
      } else {
        const pos = format.positions[pointers[p.id] % P];
        onField.push({ playerId: p.id, position: pos });
        pointers[p.id] += 1;
      }
    });
    intervals.push({ index: i, startMin, endMin, onField, benched });
  }
  return { intervals, finalPointers: pointers };
}

function MatchDayTab({ players, teams, formats, matchdays, persistPlayers, persistTeams, persistFormats, persistMatchdays, flash }) {
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
        />
      )}
      {sub === "squad" && (
        <SquadView players={players} teams={teams} persistPlayers={persistPlayers} persistTeams={persistTeams} flash={flash} />
      )}
      {sub === "formats" && (
        <FormatsView formats={formats} persistFormats={persistFormats} flash={flash} />
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
        width: size, height: size, minWidth: size, borderRadius: "50%",
        background: color, color: "#fff", fontFamily: "Inter", fontWeight: 800,
        fontSize: size * 0.52, display: "inline-flex", alignItems: "center",
        justifyContent: "center", lineHeight: 1, flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

function TeamToggles({ teams, selected, onToggle, size = "sm" }) {
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

function SquadView({ players, teams, persistPlayers, persistTeams, flash }) {
  const [name, setName] = useState("");
  const [selectedTeams, setSelectedTeams] = useState([SQUAD_TEAM]);
  const [bulk, setBulk] = useState("");
  const [bulkTeams, setBulkTeams] = useState([SQUAD_TEAM]);
  const [newTeam, setNewTeam] = useState("");
  const [teamFilter, setTeamFilter] = useState("All");

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

  const shown = teamFilter === "All" ? players : players.filter((p) => p.teams.includes(teamFilter));

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
            <TextInput placeholder="e.g. Team A" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} />
            <Button variant="dark" icon={Plus} onClick={addTeam}>Add</Button>
          </div>
        </Card>

        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">ADD A PLAYER</div>
          <div className="space-y-2">
            <TextInput placeholder="Player name" value={name} onChange={(e) => setName(e.target.value)} />
            <Label>Teams</Label>
            <TeamToggles teams={teams} selected={selectedTeams} onToggle={toggleIn(setSelectedTeams)} />
            <Button variant="primary" icon={UserPlus} onClick={addPlayer}>Add player</Button>
          </div>
        </Card>

        <Card className="p-4">
          <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">BULK ADD</div>
          <p className="text-xs mb-2" style={{ color: COLORS.inkSoft }}>One name per line — handy for getting all 31 in at once.</p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={5}
            placeholder={"Jack\nOllie\nFreddie…"}
            className="w-full text-sm rounded-lg px-2.5 py-2 border outline-none resize-none mb-2"
            style={{ borderColor: "#D9D3C1" }}
          />
          <Label>Teams</Label>
          <div className="mb-2">
            <TeamToggles teams={teams} selected={bulkTeams} onToggle={toggleIn(setBulkTeams)} />
          </div>
          <Button variant="dark" icon={UserPlus} onClick={addBulk}>Add all</Button>
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
        <p className="text-xs mb-2" style={{ color: COLORS.inkSoft }}>{players.length} player{players.length === 1 ? "" : "s"} in the squad</p>
        <div className="space-y-2">
          {shown.map((p) => (
            <Card key={p.id} className="p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-[120px]">
                <div className="text-sm font-bold" style={{ color: COLORS.ink }}>{p.name}</div>
                <div className="text-[11px]" style={{ color: COLORS.inkSoft }}>
                  {p.gamesPlayed || 0} games played
                  {p.positionCounts && Object.keys(p.positionCounts).length > 0 && (
                    <> · {Object.entries(p.positionCounts).map(([k, v]) => `${k} ${v}`).join(", ")}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <TeamToggles teams={teams} selected={p.teams} onToggle={(t) => togglePlayerTeam(p.id, t)} />
                <button onClick={() => removePlayer(p.id)}><Trash2 size={15} color={COLORS.danger} /></button>
              </div>
            </Card>
          ))}
          {shown.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: COLORS.inkSoft }}>No players here yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FormatsView({ formats, persistFormats, flash }) {
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
                    <Pill tone="amber">{f.name}</Pill>
                    <div className="flex items-center gap-2">
                      <button onClick={() => startEdit(f)} title="Edit format"><Edit3 size={15} color={COLORS.inkSoft} /></button>
                      <button onClick={() => deleteFormat(f.id)} title="Delete format"><Trash2 size={15} color={COLORS.danger} /></button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {f.positions.map((p, i) => <Pill key={i} tone="chalk">{p}</Pill>)}
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
        <Label>Number of players per side</Label>
        <Select
          value={String(playersPerSide)}
          onChange={(v) => { setPlayersPerSide(Number(v)); setCounts({}); }}
          options={Array.from({ length: 9 }, (_, i) => i + 3).map((n) => ({ value: String(n), label: `${n}v${n}` }))}
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
          <Button variant="primary" icon={Save} onClick={saveFormat}>{editingId ? "Save changes" : "Save format"}</Button>
          {editingId && <Button variant="subtle" onClick={resetForm}>Cancel</Button>}
        </div>
      </Card>
    </div>
  );
}

function MatchDaysView({ players, teams, formats, matchdays, persistPlayers, persistMatchdays, flash }) {
  const [date, setDate] = useState(todayStr());
  const [teamFilter, setTeamFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState([]);
  const [expanded, setExpanded] = useState(null);

  const eligible = teamFilter === "All" ? players : players.filter((p) => p.teams.includes(teamFilter));

  const toggleSelect = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const createMatchDay = async () => {
    if (!selectedIds.length) return flash("Select who's present today");
    const md = { id: uid(), date, teamFilter, presentPlayerIds: selectedIds, games: [] };
    await persistMatchdays([md, ...matchdays]);
    setSelectedIds([]);
    setExpanded(md.id);
    flash("Match day created — now add your games below");
  };

  const deleteMatchDay = async (id) => {
    await persistMatchdays(matchdays.filter((m) => m.id !== id));
    flash("Match day deleted");
  };

  if (!formats.length) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm" style={{ color: COLORS.inkSoft }}>Add a game format (e.g. 4v4) in the Formats tab before setting up a match day.</p>
      </Card>
    );
  }
  if (!players.length) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm" style={{ color: COLORS.inkSoft }}>Add your squad in the Squad tab before setting up a match day.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div style={{ fontFamily: "Bebas Neue", color: COLORS.pitch }} className="text-lg mb-3">NEW MATCH DAY</div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <Label>Date</Label>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Filter squad by team</Label>
            <div className="flex flex-wrap gap-1.5">
              {["All", ...teams].map((t) => {
                const on = teamFilter === t;
                const color = t === "All" ? COLORS.pitch : getTeamColor(t);
                return (
                  <button
                    key={t}
                    onClick={() => { setTeamFilter(t); setSelectedIds([]); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap"
                    style={{ background: on ? color : hexToRgba(color, 0.12), color: on ? "#fff" : COLORS.ink }}
                  >
                    {t !== "All" && <TeamBadge team={t} size={14} />}
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <Label>Who's here today? ({selectedIds.length} selected)</Label>
        <div className="flex flex-wrap gap-1.5 mb-3 max-h-52 overflow-y-auto p-1">
          {eligible.map((p) => {
            const on = selectedIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggleSelect(p.id)}
                className="flex items-center gap-1.5 pl-1 pr-2.5 py-1.5 text-xs font-semibold rounded-full"
                style={{ background: on ? COLORS.amber : COLORS.chalkDim, color: COLORS.ink }}
              >
                <TeamBadge team={p.teams[0]} size={15} />
                {p.name}
              </button>
            );
          })}
        </div>
        <Button variant="primary" icon={Plus} onClick={createMatchDay}>Create match day</Button>
      </Card>

      {[...matchdays].sort((a, b) => b.date.localeCompare(a.date)).map((md) => (
        <MatchDayCard
          key={md.id}
          matchday={md}
          players={players}
          formats={formats}
          matchdays={matchdays}
          persistMatchdays={persistMatchdays}
          persistPlayers={persistPlayers}
          isOpen={expanded === md.id}
          onToggle={() => setExpanded(expanded === md.id ? null : md.id)}
          onDelete={() => deleteMatchDay(md.id)}
          flash={flash}
        />
      ))}
    </div>
  );
}

function MatchDayCard({ matchday, players, formats, matchdays, persistMatchdays, persistPlayers, isOpen, onToggle, onDelete, flash }) {
  const presentPlayers = matchday.presentPlayerIds.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  const [formatId, setFormatId] = useState(formats[0]?.id || "");
  const [opponent, setOpponent] = useState("");
  const [duration, setDuration] = useState(10);
  const format = formats.find((f) => f.id === formatId) || formats[0];
  const suggested = format ? suggestSubInterval(presentPlayers.length, format.positions.length) : 2;
  const [subInterval, setSubInterval] = useState(suggested);

  useEffect(() => {
    if (format) setSubInterval(suggestSubInterval(presentPlayers.length, format.positions.length));
  }, [formatId]);

  const updateMatchday = async (patch) => {
    await persistMatchdays(matchdays.map((m) => (m.id === matchday.id ? { ...m, ...patch } : m)));
  };

  const addGame = async () => {
    if (!format) return flash("Add a format first");
    const plan = generateRotationPlan(presentPlayers, format, Number(duration), Number(subInterval));
    if (!plan) return flash(`Need at least ${format.positions.length} players present for ${format.name}`);
    const game = {
      id: uid(),
      formatId: format.id,
      formatName: format.name,
      formatGroup: `${format.positions.length}v${format.positions.length}`,
      opponent: opponent.trim(),
      duration: Number(duration),
      subInterval: Number(subInterval),
      intervals: plan.intervals,
      finalPointers: plan.finalPointers,
      status: "planned",
    };
    await updateMatchday({ games: [...matchday.games, game] });
    setOpponent("");
    flash("Game added with rotation plan");
  };

  const regenerateGame = async (game) => {
    const fmt = formats.find((f) => f.id === game.formatId);
    if (!fmt) return;
    const plan = generateRotationPlan(presentPlayers, fmt, game.duration, game.subInterval);
    if (!plan) return flash("Not enough players present for that format");
    await updateMatchday({
      games: matchday.games.map((g) => (g.id === game.id ? { ...g, intervals: plan.intervals, finalPointers: plan.finalPointers } : g)),
    });
    flash("Rotation reshuffled");
  };

  const deleteGame = async (id) => {
    await updateMatchday({ games: matchday.games.filter((g) => g.id !== id) });
  };

  const markPlayed = async (game) => {
    const nextPlayers = players.map((p) => {
      if (!(p.id in game.finalPointers)) return p;
      const posCounts = { ...(p.positionCounts || {}) };
      game.intervals.forEach((iv) => {
        iv.onField.forEach((of) => {
          if (of.playerId === p.id) posCounts[of.position] = (posCounts[of.position] || 0) + 1;
        });
      });
      return {
        ...p,
        rotationPointer: game.finalPointers[p.id],
        positionCounts: posCounts,
        gamesPlayed: (p.gamesPlayed || 0) + 1,
      };
    });
    await persistPlayers(nextPlayers);
    await updateMatchday({ games: matchday.games.map((g) => (g.id === game.id ? { ...g, status: "played" } : g)) });
    flash("Game logged — player stats updated");
  };

  const nameFor = (id) => players.find((p) => p.id === id)?.name || "?";

  return (
    <Card className="overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 text-left">
        <div className="flex items-center gap-3">
          {isOpen ? <ChevronDown size={16} color={COLORS.inkSoft} /> : <ChevronRight size={16} color={COLORS.inkSoft} />}
          <div>
            <div className="text-sm font-bold" style={{ color: COLORS.ink, fontFamily: "Inter" }}>{matchday.date}</div>
            <div className="text-xs flex items-center gap-1.5" style={{ color: COLORS.inkSoft }}>
              {presentPlayers.length} present
              {matchday.teamFilter !== "All" && (
                <span className="inline-flex items-center gap-1">
                  · <TeamBadge team={matchday.teamFilter} size={14} /> {matchday.teamFilter}
                </span>
              )}
              · {matchday.games.length} game{matchday.games.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {presentPlayers.map((p) => <Pill key={p.id} tone="chalk">{p.name}</Pill>)}
          </div>

          <div className="rounded-lg border p-3 mb-4" style={{ borderColor: "#E4DFD0" }}>
            <div className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: COLORS.inkSoft }}>Add a game</div>
            <div className="grid sm:grid-cols-2 gap-2 mb-2">
              <Select value={formatId} onChange={setFormatId} options={formats.map((f) => ({ value: f.id, label: `${f.positions.length}v${f.positions.length} · ${f.name}` }))} />
              <TextInput placeholder="Opponent (optional)" value={opponent} onChange={(e) => setOpponent(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <Label>Duration (min)</Label>
                <TextInput type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
              <div>
                <Label>Sub every (min)</Label>
                <TextInput type="number" min="0.5" step="0.5" value={subInterval} onChange={(e) => setSubInterval(e.target.value)} />
              </div>
            </div>
            <Button variant="primary" size="sm" icon={Shuffle} onClick={addGame}>Generate & add game</Button>
          </div>

          <div className="space-y-3">
            {matchday.games.map((g) => (
              <div key={g.id} className="rounded-lg border p-3" style={{ borderColor: "#E4DFD0" }}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm font-bold" style={{ color: COLORS.ink }}>{g.formatGroup ? `${g.formatGroup} · ` : ""}{g.formatName}</span>
                    {g.opponent && <span className="text-xs ml-2" style={{ color: COLORS.inkSoft }}>vs {g.opponent}</span>}
                    <span className="text-xs ml-2" style={{ color: COLORS.inkSoft }}>· {g.duration} min</span>
                  </div>
                  {g.status === "played" ? <Pill tone="pitch">Played</Pill> : <Pill tone="amber">Planned</Pill>}
                </div>
                <div className="space-y-1.5 mb-2">
                  {g.intervals.map((iv) => (
                    <div key={iv.index} className="text-xs rounded-md px-2 py-1.5" style={{ background: COLORS.chalkDim }}>
                      <span className="font-mono font-semibold" style={{ color: COLORS.inkSoft, fontFamily: "JetBrains Mono" }}>
                        {iv.startMin}–{iv.endMin}m
                      </span>
                      <span className="ml-2" style={{ color: COLORS.ink }}>
                        {iv.onField.map((of) => `${nameFor(of.playerId)} (${of.position})`).join(", ")}
                      </span>
                      {iv.benched.length > 0 && (
                        <span className="ml-2 italic" style={{ color: COLORS.inkSoft }}>
                          — bench: {iv.benched.map(nameFor).join(", ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {g.status !== "played" && (
                    <>
                      <Button variant="dark" size="sm" icon={CheckCircle2} onClick={() => markPlayed(g)}>Mark played</Button>
                      <Button variant="ghost" size="sm" icon={Repeat} onClick={() => regenerateGame(g)}>Reshuffle</Button>
                    </>
                  )}
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => deleteGame(g.id)}>Delete</Button>
                </div>
              </div>
            ))}
            {matchday.games.length === 0 && (
              <p className="text-xs text-center py-3" style={{ color: COLORS.inkSoft }}>No games added to this match day yet.</p>
            )}
          </div>

          <div className="mt-3">
            <Button variant="danger" size="sm" icon={Trash2} onClick={onDelete}>Delete match day</Button>
          </div>
        </div>
      )}
    </Card>
  );
}