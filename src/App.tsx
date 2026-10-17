import { useCallback, useEffect, useRef, useState } from "react";
import { sendAction, subscribeToRoom, type GameSnapshot } from "./lib/api";
import { isConfigured } from "./lib/supabase";
import { isValidChatMessage, isValidClue, isValidNickname, isValidRoomCode, phaseDuration, secondsRemaining } from "./lib/game";

function newPlayerToken() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID() + crypto.randomUUID();
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}
function playerToken() {
  const key = "shadow-impostor-player-token";
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 32) return existing;
  } catch { /* storage may be disabled; this session can still play */ }
  const token = newPlayerToken();
  try { localStorage.setItem(key, token); } catch { /* persistence is optional */ }
  return token;
}
let token = playerToken();
type View = "home" | "room";
export default function App() {
  const [view, setView] = useState<View>("home");
  const [loadingScreen, setLoadingScreen] = useState(true);
  const [bootVideoReady, setBootVideoReady] = useState(false);
  const [minimumLoadingElapsed, setMinimumLoadingElapsed] = useState(false);
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clue, setClue] = useState("");
  const [message, setMessage] = useState("");
  const [guess, setGuess] = useState("");
  const [target, setTarget] = useState("");
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [roleVisible, setRoleVisible] = useState(false);
  const [copiedRoomCode, setCopiedRoomCode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const previousPhaseRef = useRef<string | undefined>(undefined);
  const [stats, setStats] = useState<{games_played:number;crew_wins:number;impostor_wins:number}|undefined>();
  const [clockNow, setClockNow] = useState(Date.now());
  const shellRef = useRef<HTMLElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const ambientContextRef = useRef<AudioContext | null>(null);
  const ambientNodesRef = useRef<AudioNode[]>([]);

  const act = useCallback(async (action: Parameters<typeof sendAction>[0]) => {
    setBusy(true); setError("");
    try {
      const result = await sendAction(action);
      if ("room" in result) {
        setGame(result as GameSnapshot);
        setStats((result as GameSnapshot).stats);
        setView("room");
      } else if (action.action === "leave_room") {
        setGame(null); setView("home");
      } else if (game) {
        // The requested action may already have succeeded even if this follow-up refresh fails.
        // Never tell the UI to retry a non-idempotent action such as chat because of a refresh error.
        try {
          const fresh = await sendAction({action:"get_state", code:game.room.code, token});
          if ("room" in fresh) { setGame(fresh as GameSnapshot); setStats((fresh as GameSnapshot).stats); }
        } catch { /* the room polling loop will reconcile state */ }
      }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); return false; }
    finally { setBusy(false); }
  }, [game]);

  const refresh = useCallback(async () => {
    if (!game?.room.code) return;
    try {
      const result = await sendAction({action:"get_state", code:game.room.code, token});
      if ("room" in result) { setGame(result as GameSnapshot); setStats((result as GameSnapshot).stats); }
    } catch { /* brief network interruptions are handled by the next refresh */ }
  }, [game?.room.code]);

  useEffect(() => {
    const minimum = window.setTimeout(() => setMinimumLoadingElapsed(true), 6800);
    const failsafe = window.setTimeout(() => setLoadingScreen(false), 9000);
    return () => { window.clearTimeout(minimum); window.clearTimeout(failsafe); };
  }, []);

  useEffect(() => {
    if (bootVideoReady && minimumLoadingElapsed) setLoadingScreen(false);
  }, [bootVideoReady, minimumLoadingElapsed]);

  useEffect(() => {
    const clock = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  // Pointer tracking is direct-to-DOM to avoid React renders on mouse movement.
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const shell = shellRef.current;
    const cursor = cursorRef.current;
    if (!shell || !cursor) return;
    let lastRipple = 0;
    const move = (event: PointerEvent) => {
      shell.style.setProperty("--pointer-x", `${event.clientX}px`);
      shell.style.setProperty("--pointer-y", `${event.clientY}px`);
      cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      const target = event.target instanceof Element ? event.target : null;
      cursor.classList.toggle("is-interactive", !!target?.closest("button, a, input, textarea, [role=button], .vote-card"));
      cursor.classList.toggle("is-text", !!target?.closest("input, textarea"));
    };
    const click = (event: PointerEvent) => {
      const now = performance.now();
      if (now - lastRipple < 45) return;
      lastRipple = now;
      const ripple = document.createElement("span");
      ripple.className = "click-ripple";
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      document.body.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 760);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", click, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", click);
    };
  }, []);

  useEffect(() => {
    setVoteSubmitted(false);
    setTarget("");
    setRoleVisible(false);
  }, [game?.room.code, game?.room.phase, game?.room.round, game?.room.tie_count]);

  const copyRoomCode = async () => {
    if (!game?.room.code) return;
    try {
      await navigator.clipboard.writeText(game.room.code);
      setCopiedRoomCode(true);
      window.setTimeout(() => setCopiedRoomCode(false), 1800);
    } catch {
      setError("Copy was blocked by your browser. Select the room code and copy it manually.");
    }
  };

  const playFeedback = (kind: "reveal" | "confirm", force = false) => {
    if ((!soundEnabled && !force) || typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) { setError("Sound is not supported by this browser."); return; }
      const context = new AudioContextClass();
      if (context.state === "suspended") void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(kind === "reveal" ? 196 : 520, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(kind === "reveal" ? 392 : 680, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.19);
      oscillator.onended = () => { void context.close(); };
    } catch { setError("Could not play sound. Check your browser audio settings."); }
  };

  // Procedural stealth-game soundtrack: evolving drone, pulsing bass, and sparse minor-key synth notes.
  // Audio starts only after the player enables THEME, satisfying browser gesture policies.
  useEffect(() => {
    if (!soundEnabled) {
      const oldContext = ambientContextRef.current;
      ambientContextRef.current = null;
      ambientNodesRef.current = [];
      if (oldContext && oldContext.state !== "closed") void oldContext.close();
      return;
    }
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) { setError("Procedural music is not supported by this browser."); return; }
    const context = new AudioContextClass();
    ambientContextRef.current = context;
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    master.gain.value = 0.42;
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.025;
    compressor.release.value = 0.3;
    master.connect(compressor);
    compressor.connect(context.destination);

    const droneFilter = context.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 430;
    droneFilter.Q.value = 0.7;
    droneFilter.connect(master);
    const droneA = context.createOscillator();
    const droneB = context.createOscillator();
    const droneGain = context.createGain();
    droneA.type = "sawtooth";
    droneB.type = "triangle";
    droneA.frequency.value = 55;
    droneB.frequency.value = 82.41;
    droneB.detune.value = -7;
    droneGain.gain.value = 0.035;
    droneA.connect(droneGain); droneB.connect(droneGain); droneGain.connect(droneFilter);
    droneA.start(); droneB.start();

    const pulseGain = context.createGain();
    pulseGain.gain.value = 0.0001;
    pulseGain.connect(master);
    const pulse = context.createOscillator();
    pulse.type = "sine";
    pulse.frequency.value = 55;
    pulse.connect(pulseGain);
    pulse.start();

    let step = 0;
    const notes = [110, 130.81, 164.81, 196, 164.81, 146.83, 130.81, 98];
    const tick = () => {
      if (context.state !== "running") return;
      const now = context.currentTime;
      pulseGain.gain.cancelScheduledValues(now);
      pulseGain.gain.setValueAtTime(0.0001, now);
      pulseGain.gain.exponentialRampToValueAtTime(step % 4 === 0 ? 0.11 : 0.055, now + 0.035);
      pulseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      if (step % 2 === 0) {
        const note = context.createOscillator();
        const envelope = context.createGain();
        const filter = context.createBiquadFilter();
        note.type = "triangle";
        note.frequency.setValueAtTime(notes[(step / 2) % notes.length], now);
        note.frequency.exponentialRampToValueAtTime(notes[(step / 2) % notes.length] * 0.995, now + 0.34);
        filter.type = "lowpass";
        filter.frequency.value = step % 8 === 0 ? 1250 : 760;
        envelope.gain.setValueAtTime(0.0001, now);
        envelope.gain.exponentialRampToValueAtTime(step % 8 === 0 ? 0.095 : 0.052, now + 0.025);
        envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
        note.connect(filter); filter.connect(envelope); envelope.connect(master);
        note.start(now); note.stop(now + 0.38);
        note.onended = () => { note.disconnect(); filter.disconnect(); envelope.disconnect(); };
      }
      step += 1;
    };
    const timer = window.setInterval(tick, 310);
    void context.resume();
    ambientNodesRef.current = [master, compressor, droneFilter, droneA, droneB, droneGain, pulseGain, pulse];
    return () => {
      window.clearInterval(timer);
      if (ambientContextRef.current === context) ambientContextRef.current = null;
      ambientNodesRef.current = [];
      if (context.state !== "closed") void context.close();
    };
  }, [soundEnabled]);

  useEffect(() => {
    const phaseNow = game?.room.phase;
    if (previousPhaseRef.current !== undefined && phaseNow && previousPhaseRef.current !== phaseNow) playFeedback("confirm");
    previousPhaseRef.current = phaseNow;
  }, [game?.room.phase, soundEnabled]);

  useEffect(() => {
    if (!game?.room.code) return;
    const unsubscribe = subscribeToRoom(game.room.code, () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [game?.room.code, refresh]);

  const createRoom = async () => {
    if (!isValidNickname(name)) { setError("Use 2-20 characters: letters, numbers, spaces, dots, hyphens or underscores."); return; }
    await act({action:"create_room", name:name.trim(), token});
  };
  const joinRoom = async () => {
    if (name.trim().length < 2) { setError("Enter a nickname with at least 2 characters."); return; }
    if (!isValidRoomCode(codeInput)) { setError("Enter the full 6-character room code."); return; }
    // Joining a room needs a new guest identity, including same-browser testing.
    const joinToken = newPlayerToken();
    token = joinToken;
    try { localStorage.setItem("shadow-impostor-player-token", joinToken); } catch { /* same-tab play still works without storage */ }
    await act({action:"join_room", code:codeInput.trim().toUpperCase(), name:name.trim(), token:joinToken});
  };
  const sendClue = async () => {
    if (!game || !isValidClue(clue)) { if (game) setError("Clues must be 1-100 characters."); return; }
    const ok = await act({action:"submit_clue", code:game.room.code, token, clue:clue.trim()}); if (ok) { setClue(""); playFeedback("confirm"); }
  };
  const sendMessage = async () => {
    if (!game || !isValidChatMessage(message)) { if (game) setError("Chat messages must be 1-300 characters."); return; }
    const ok = await act({action:"send_chat", code:game.room.code, token, message:message.trim()}); if (ok) { setMessage(""); playFeedback("confirm"); }
  };
  const phase = game?.room.phase;
  const submittedClues = game?.players.filter(p => p.has_clued).length ?? 0;
  const playerTotal = game?.players.length ?? 0;
  const phaseSeconds = phaseDuration(phase);
  const secondsLeft = secondsRemaining(phase, game?.room.phase_started_at, clockNow);
  const phaseProgress = phaseSeconds > 0 ? Math.min(100, Math.max(0, ((phaseSeconds - secondsLeft) / phaseSeconds) * 100)) : 0;
  const waitingTitle = phase === "lobby" ? "The crew is assembling" : phase === "clue" ? "The clues are taking shape" : phase === "discussion" ? "Read between the lines" : phase === "voting" ? "The votes are being sealed" : phase === "guess" ? "One last chance" : phase === "results" ? "The truth is out" : "The shadows are moving";
  const isResults = phase === "results" && !!game;
  const playerWon = isResults && game.you.role === game.room.winner;
  const backgroundVideo = view === "home" || !game ? "BG2.mp4" : isResults ? (playerWon ? "YouWon.mp4" : "GAMEOVER.mp4") : phase === "lobby" ? "BG2.mp4" : "BG4.mp4";
  const mediaUrl = (file: string) => `${import.meta.env.BASE_URL}media/${file}`;
  return <main ref={shellRef} className={`${busy ? "shell is-busy" : "shell"} ${loadingScreen ? "has-loading-screen" : ""} ${view === "home" || !game ? "screen-home" : isResults ? (playerWon ? "screen-won" : "screen-gameover") : phase === "voting" || phase === "discussion" ? "screen-voting" : "screen-game"}`}>
    <div className="scene-video-layer" aria-hidden="true">{backgroundVideo && <video key={backgroundVideo} className={`scene-video scene-video-${backgroundVideo.replace(".mp4","").toLowerCase()}`} autoPlay muted loop playsInline preload={view === "home" || !game ? "auto" : "metadata"} onError={e => { e.currentTarget.style.visibility = "hidden"; }} onLoadedData={e => { e.currentTarget.style.visibility = "visible"; }}><source src={mediaUrl(backgroundVideo)} type="video/mp4" /></video>}<div className="scene-video-shade" /></div>
    <div className="cursor-orb" ref={cursorRef} aria-hidden="true"><span /></div>
    <div className="glow glow-one" /><div className="glow glow-two" />
    {loadingScreen && <section className="boot-screen" aria-label="Loading Shadow Impostor"><video className="boot-video" autoPlay muted loop playsInline preload="auto" onCanPlay={() => setBootVideoReady(true)} onError={() => setBootVideoReady(true)}><source src={mediaUrl("BG1.mp4")} type="video/mp4" /></video><div className="boot-shade" /><div className="boot-content"><span className="boot-mark">◈</span><p className="boot-kicker">A SOCIAL DEDUCTION EXPERIENCE</p><h1>SHADOW <span>IMPOSTOR</span></h1><div className="boot-loader" role="status" aria-live="polite"><span className="boot-loader-track"><i /></span><span>INITIALIZING THE SHADOWS</span></div><p className="boot-footnote">Securing the room · Preparing your experience</p></div><span className="boot-version">SYSTEM READY WHEN YOU ARE</span></section>}
    <header><span className="mark">◈</span><span>SHADOW<span className="accent"> IMPOSTOR</span></span><div className="header-actions"><button className="sound-toggle" type="button" aria-pressed={soundEnabled} onClick={() => { const enabling = !soundEnabled; setSoundEnabled(enabling); if (enabling) playFeedback("confirm", true); }} title={soundEnabled ? "Turn procedural gameplay music off" : "Turn procedural gameplay music on"}><span>{soundEnabled ? "♫" : "♪"}</span> MUSIC {soundEnabled ? "ON" : "OFF"}</button><span className="status"><i /> LIVE SOCIAL DEDUCTION</span></div></header>
    {view === "home" || !game ? <section className="hero cinematic-home">
      <div className="cinema-scene" aria-hidden="true"><div className="scene-grid"/><div className="scene-moon"/><div className="scene-ring scene-ring-one"/><div className="scene-ring scene-ring-two"/><div className="scene-core">◈</div><span className="scene-coordinate coordinate-one">SECTOR 07 / UNKNOWN</span><span className="scene-coordinate coordinate-two">TRUST INDEX: UNSTABLE</span><span className="scene-caption">A SOCIAL DEDUCTION EXPERIENCE</span></div>
      <div className="cinema-copy"><p className="eyebrow"><span className="eyebrow-line"/> TRUST IS A LIMITED RESOURCE</p><h1>ONE OF YOU<br/><span>IS LYING.</span></h1>
      <p className="intro">A secret word. A room full of suspects. Every clue brings you closer to the truth, or closer to being exposed.</p></div>
      <div className="panel"><div className="panel-head"><span className="mini-icon">✦</span><div><h2>Enter the shadows</h2><p>Create a room or join your crew with a code.</p></div></div>
        {!isConfigured && <p className="notice">Backend setup required: configure the Supabase URL and publishable key in your hosting environment.</p>}
        <label htmlFor="nickname">YOUR NICKNAME</label><input id="nickname" className="text-input" placeholder="How should we call you?" maxLength={20} value={name} onChange={e=>setName(e.target.value)} />
        <button className="primary" disabled={busy||!isConfigured} onClick={()=>void createRoom()}>{busy ? "Creating room..." : "Create a room"} <span>↗</span></button>
        <div className="join"><span>ALREADY HAVE A ROOM CODE?</span><div><input aria-label="Room code" placeholder="ENTER CODE" maxLength={6} value={codeInput} onChange={e=>setCodeInput(e.target.value.toUpperCase())}/><button disabled={busy||!isConfigured} onClick={()=>void joinRoom()}>{busy ? "Joining..." : "Join ↗"}</button></div></div>
        {stats && <p className="fine">YOUR STATS · {stats.games_played} GAMES · {stats.crew_wins} CREW WINS · {stats.impostor_wins} IMPOSTOR WINS</p>}
      </div><div className="features"><div><b>01</b><span><strong>Secret words</strong><small>One word. Two sides.</small></span></div><div><b>02</b><span><strong>Give clues</strong><small>Say enough, not too much.</small></span></div><div><b>03</b><span><strong>Vote to expose</strong><small>Trust your instincts.</small></span></div></div>
    </section> : <section className="hero room-view" key={`room-${game.room.phase}-${game.room.round}`}>
      <p className="eyebrow">ROOM {game.room.code} · ROUND {game.room.round}</p>
      <h1>{phase === "lobby" ? "Gather your crew." : phase === "results" ? "The shadows settle." : phase === "guess" ? "One final guess." : phase === "voting" ? "Choose carefully." : phase === "discussion" ? "Read the room." : "Your word is your weapon."}</h1>
      <p className="intro">{phase === "lobby" ? "Share the code. You need 4 to 8 players to begin." : "Room updates live. Keep your role and secret word private."}</p>
      <div className="panel">
        <button className="room-code room-code-button" type="button" onClick={() => void copyRoomCode()} aria-label="Copy room code"><span className="room-code-label">ROOM CODE</span><strong>{game.room.code}</strong><span className="room-code-copy">{copiedRoomCode ? "✓ COPIED" : "▢ COPY CODE"}</span></button>
        <div className="phase-banner"><div className="phase-orb"><span>◈</span></div><div className="phase-copy"><p className="eyebrow">CURRENT PHASE</p><h2>{waitingTitle}</h2><p>{phase === "lobby" ? "Invite your crew. The game begins when the host is ready." : phase === "clue" ? `${submittedClues} of ${playerTotal} players have submitted clues.` : phase === "voting" ? "Choose carefully. Votes stay hidden until the reveal." : phase === "discussion" ? "Compare clues and look for the odd one out." : phase === "guess" ? "Can the impostor name the crew's word?" : phase === "results" ? "The round is complete. Review the outcome below." : "Waiting for the room to update."}</p></div><div className="live-pulse"><i /> LIVE</div></div>{phaseSeconds > 0 && <div className="phase-timer" aria-label={`${secondsLeft} seconds remaining`}><div className="timer-top"><span>TIME REMAINING</span><strong className={secondsLeft <= 10 ? "timer-urgent" : ""}>{String(Math.floor(secondsLeft/60)).padStart(2,"0")}:{String(secondsLeft%60).padStart(2,"0")}</strong></div><div className="timer-track"><span style={{width:`${phaseProgress}%`}} /></div></div>}
        <div className="panel-head"><span className="mini-icon">✦</span><div><h2>{game.you.name}{game.you.is_host ? " · HOST" : ""}</h2><p>{game.room.player_count} players · {phase?.toUpperCase()}</p></div></div>
        {phase === "lobby" && <><div className="lobby-progress"><div><span>CREW ASSEMBLY</span><strong>{playerTotal}/8</strong></div><div className="lobby-progress-track"><span style={{width:`${Math.min(100, playerTotal/8*100)}%`}} /></div><small>{playerTotal < 4 ? `${4-playerTotal} more ${4-playerTotal===1?"player":"players"} needed to unlock launch` : playerTotal === 8 ? "Crew full. The game is ready." : "Minimum reached. More suspects can still join."}</small></div><h2>Players</h2><ul className="players">{game.players.map(p=><li key={p.player_id}><span>{p.name}{p.is_host?" · HOST":""}</span><span>{p.alive?"●":"○"}</span></li>)}</ul><button className="primary launch-button" disabled={busy||!game.you.is_host||game.room.player_count<4} onClick={()=>{playFeedback("confirm");void act({action:"start_game",code:game.room.code,token})}}>{busy ? "Launching game..." : game.you.is_host ? (game.room.player_count<4?"Waiting for 4 players":"Start game"):"Waiting for host"} <span>↗</span></button></>}
        {phase !== "lobby" && <div className={`secret ${roleVisible ? "secret-revealed" : "secret-concealed"}`}><div className="secret-card-top"><p className="eyebrow">PERSONAL DOSSIER · ONLY YOU</p><span className="secret-lock">{roleVisible ? "ACCESS GRANTED" : "ENCRYPTED"}</span></div>{roleVisible ? <div className="role-reveal-content" key={`${game.room.round}-${game.you.role}`}><p className={`role-stamp ${game.you.role === "impostor" ? "role-stamp-impostor" : ""}`}>{game.you.role === "impostor" ? "☠" : "◈"}</p><h2>{game.you.role?.toUpperCase() ?? "UNKNOWN"}</h2><p className="word">{game.you.word ?? "Word hidden"}</p><p className="fine">Keep this word secret. Impostors receive a decoy word.</p></div> : <div className="secret-locked-content"><div className="secret-locked-glyph">◈</div><h2>YOUR IDENTITY IS SEALED</h2><p>Your role and word are hidden. Make sure nobody is looking before you reveal them.</p></div>}<button className="secret-reveal-button" type="button" onClick={() => { setRoleVisible(value => !value); if (!roleVisible) playFeedback("reveal"); }}>{roleVisible ? "Hide my role" : "Reveal my role"}<span>{roleVisible ? "◉" : "◎"}</span></button></div>}
        {phase === "clue" && game.you.alive && !game.players.find(p=>p.player_id===game.you.player_id)?.has_clued && <div className="action-form"><label>YOUR CLUE</label><input className="text-input" maxLength={100} placeholder="Give a subtle clue..." value={clue} onChange={e=>setClue(e.target.value)}/><button className="primary" disabled={busy||!clue.trim()} onClick={()=>void sendClue()}>{busy ? "Sending clue..." : "Submit clue"} <span>↗</span></button></div>}
        {phase === "discussion" && game.you.is_host && <button className="secondary" disabled={busy} onClick={()=>void act({action:"begin_voting",code:game.room.code,token})}>Move to voting</button>}
        {(phase === "discussion" || phase === "voting") && <div className="clues"><h2>Clues from the crew</h2>{game.players.filter(p=>p.clue).map(p=><p key={p.player_id}><strong>{p.name}:</strong> {p.clue}</p>)}{game.players.every(p=>!p.clue)&&<p className="muted">No clues submitted yet.</p>}</div>}
        {phase === "voting" && game.you.alive && <div className="action-form"><label>CAST YOUR VOTE <span className="vote-private">PRIVATE BALLOT</span></label><p className="vote-hint">Who feels out of place? Select a player to lock in your choice.</p><div className="vote-grid">{game.players.filter(p=>p.alive&&p.player_id!==game.you.player_id).map(p=><button type="button" key={p.player_id} className={`vote-card ${target===p.player_id?"selected":""}`} disabled={busy||voteSubmitted} aria-pressed={target===p.player_id} onClick={()=>setTarget(p.player_id)}><span className="vote-avatar">{p.name.trim().charAt(0).toUpperCase()}</span><span className="vote-name">{p.name}</span><span className="vote-select">{target===p.player_id?"✓":"＋"}</span></button>)}</div>{voteSubmitted ? <div className="vote-locked"><span>✓</span><div><strong>Vote sealed</strong><small>Your choice is locked in. Waiting for the crew...</small></div></div> : <button className="primary" disabled={busy||!target} onClick={async()=>{const ok=await act({action:"vote",code:game.room.code,token,target_player_id:target});if(ok){setVoteSubmitted(true);playFeedback("confirm")}}}>{busy ? "Sealing vote..." : "Seal my vote"} <span>↗</span></button>}<p className="vote-footnote">Your vote stays secret until the reveal.</p></div>}
        {phase === "guess" && game.you.role === "impostor" && <div className="action-form"><label>GUESS THE CREW'S SECRET WORD</label><input className="text-input" value={guess} onChange={e=>setGuess(e.target.value)} placeholder="Your final guess..." maxLength={60}/><button className="primary" disabled={busy||!guess.trim()} onClick={()=>void act({action:"guess_secret",code:game.room.code,token,guess:guess.trim()})}>{busy ? "Sending guess..." : "Make final guess"} <span>↗</span></button></div>}
        {phase === "results" && <div className={`result-reveal ${game.room.winner === "impostor" ? "impostor-win" : "crew-win"}`}><div className="result-sigil">{playerWon ? "✦" : "☠"}</div><p className="eyebrow">ROUND {game.room.round} · THE REVEAL</p><h2 className={playerWon ? "result-personal-win" : "result-personal-loss"}>{playerWon ? "YOU WON!" : "GAME OVER"}</h2><p className="result-subtitle">{playerWon ? (game.you.role === "impostor" ? "You fooled the crew and escaped the spotlight." : "You saw through the deception. The crew stands together.") : (game.you.role === "impostor" ? "The crew uncovered your identity this round." : "The impostor slipped through your crew’s defences.")}</p><div className="result-secret"><span>THE SECRET WORD</span><strong>{game.room.secret_word ?? "REVEALED SOON"}</strong></div><div className="reveal-roster"><p className="eyebrow">WHO WAS HIDING IN PLAIN SIGHT</p>{game.players.map(p=><div className="reveal-player" key={p.player_id}><span className="reveal-avatar">{p.name.trim().charAt(0).toUpperCase()}</span><span className="reveal-name">{p.name}{p.player_id===game.you.player_id?" · YOU":""}</span><span className={`role-chip ${p.role==="impostor"?"role-impostor":"role-crew"}`}>{p.role ?? "UNKNOWN"}</span></div>)}</div><button className="primary result-rematch" disabled={busy||!game.you.is_host} onClick={()=>void act({action:"start_game",code:game.room.code,token})}>{game.you.is_host ? "Run it back" : "Waiting for host"} <span>↗</span></button>{!game.you.is_host && <p className="result-footnote">The host can start the next round when everyone is ready.</p>}</div>}
        <div className="waiting-strip"><span className="waiting-dots"><i></i><i></i><i></i></span><span>{phase === "lobby" ? `${Math.max(0, 4-playerTotal)} more player${4-playerTotal===1?"":"s"} needed to start` : phase === "clue" ? "Waiting for everyone to share a clue" : phase === "discussion" ? "Use this time to compare stories" : phase === "voting" ? "Votes are private until the reveal" : phase === "guess" ? "The final guess decides the round" : "Ready for another round?"}</span></div><div className="players-wrap"><h2>Crew <span className="count-pill">{playerTotal} PLAYERS</span></h2>{phase === "clue" && <div className="crew-progress"><div><span>CLUE PROGRESS</span><strong>{submittedClues}/{game.players.filter(p=>p.alive).length}</strong></div><div className="crew-progress-track"><span style={{width:`${game.players.filter(p=>p.alive).length ? submittedClues/game.players.filter(p=>p.alive).length*100 : 0}%`}} /></div></div>}<ul className="players">{game.players.map(p=><li className="crew-player" key={p.player_id}><span className="crew-identity"><i className={p.alive?"player-dot":"player-dot dead"} /> <span>{p.name}{p.is_host?" · HOST":""}{p.player_id===game.you.player_id?" · YOU":""}<small>{!p.alive?"Eliminated":phase === "clue" ? (p.has_clued ? "Clue submitted" : "Thinking of a clue") : phase === "results" ? "Round complete" : "In the game"}</small></span></span><span className={`crew-state ${!p.alive?"state-dead":phase === "clue" && p.has_clued?"state-done":""}`}>{!p.alive?"OUT":phase === "clue" && p.has_clued?"READY":"●"}</span></li>)}</ul></div>
        {phase !== "lobby" && phase !== "results" && <div className="chat-box"><h2>Room chat</h2><div className="chat-list">{game.chat.slice(-30).map((m,i)=><p key={i}><strong>{m.name}:</strong> {m.message}</p>)}</div><div className="join"><div><input aria-label="Chat message" placeholder="Say something..." value={message} maxLength={300} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void sendMessage()}}/><button disabled={busy||!message.trim()} onClick={()=>void sendMessage()}>{busy ? "Sending..." : "Send"}</button></div></div></div>}
        <button className="secondary" disabled={busy} onClick={()=>void act({action:"leave_room",code:game.room.code,token})}>{busy ? "Leaving..." : "Leave room"}</button>
      </div>
    </section>}
    {error && <div className="error-toast" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
    <footer><span>SHADOW IMPOSTOR © 2026</span><span>WATCH YOUR WORDS <b>●</b></span></footer>
  </main>;
}