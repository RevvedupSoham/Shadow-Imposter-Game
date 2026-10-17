import { useCallback, useEffect, useState } from "react";
import { sendAction, subscribeToRoom, type GameSnapshot } from "./lib/api";
import { isConfigured } from "./lib/supabase";

function playerToken() {
  const key = "shadow-impostor-player-token";
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}
let token = playerToken();
type View = "home" | "room";
export default function App() {
  const [view, setView] = useState<View>("home");
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
  const [stats, setStats] = useState<{games_played:number;crew_wins:number;impostor_wins:number}|undefined>();

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
        const fresh = await sendAction({action:"get_state", code:game.room.code, token});
        if ("room" in fresh) { setGame(fresh as GameSnapshot); setStats((fresh as GameSnapshot).stats); }
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
    setVoteSubmitted(false);
    setTarget("");
  }, [game?.room.code, game?.room.phase, game?.room.round]);

  useEffect(() => {
    if (!game?.room.code) return;
    const unsubscribe = subscribeToRoom(game.room.code, () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [game?.room.code, refresh]);

  const createRoom = async () => {
    if (name.trim().length < 2) { setError("Enter a nickname with at least 2 characters."); return; }
    await act({action:"create_room", name:name.trim(), token});
  };
  const joinRoom = async () => {
    if (name.trim().length < 2) { setError("Enter a nickname with at least 2 characters."); return; }
    if (codeInput.trim().length < 4) { setError("Enter the room code."); return; }
    // Joining a room needs a new guest identity, including same-browser testing.
    const joinToken = crypto.randomUUID() + crypto.randomUUID();
    token = joinToken;
    localStorage.setItem("shadow-impostor-player-token", joinToken);
    await act({action:"join_room", code:codeInput.trim().toUpperCase(), name:name.trim(), token:joinToken});
  };
  const sendClue = async () => {
    if (!game || clue.trim().length < 1) return;
    await act({action:"submit_clue", code:game.room.code, token, clue:clue.trim()}); setClue("");
  };
  const sendMessage = async () => {
    if (!game || !message.trim()) return;
    await act({action:"send_chat", code:game.room.code, token, message:message.trim()}); setMessage("");
  };
  const phase = game?.room.phase;
  const submittedClues = game?.players.filter(p => p.has_clued).length ?? 0;
  const playerTotal = game?.players.length ?? 0;
  const waitingTitle = phase === "lobby" ? "The crew is assembling" : phase === "clue" ? "The clues are taking shape" : phase === "discussion" ? "Read between the lines" : phase === "voting" ? "The votes are being sealed" : phase === "guess" ? "One last chance" : phase === "results" ? "The truth is out" : "The shadows are moving";
  return <main className="shell">
    <div className="glow glow-one" /><div className="glow glow-two" />
    <header><span className="mark">◈</span><span>SHADOW<span className="accent"> IMPOSTOR</span></span><span className="status"><i /> LIVE SOCIAL DEDUCTION</span></header>
    {view === "home" || !game ? <section className="hero">
      <p className="eyebrow">TRUST IS A LIMITED RESOURCE</p><h1>Someone here<br/><span>is not one of you.</span></h1>
      <p className="intro">Share clues. Read the room. Find the impostor before they find you.</p>
      <div className="panel"><div className="panel-head"><span className="mini-icon">✦</span><div><h2>Enter the shadows</h2><p>Create a room or join your crew with a code.</p></div></div>
        {!isConfigured && <p className="notice">Backend setup required: configure the Supabase URL and publishable key in your hosting environment.</p>}
        <label htmlFor="nickname">YOUR NICKNAME</label><input id="nickname" className="text-input" placeholder="How should we call you?" maxLength={20} value={name} onChange={e=>setName(e.target.value)} />
        <button className="primary" disabled={busy||!isConfigured} onClick={()=>void createRoom()}>Create a room <span>↗</span></button>
        <div className="join"><span>ALREADY HAVE A ROOM CODE?</span><div><input aria-label="Room code" placeholder="ENTER CODE" maxLength={6} value={codeInput} onChange={e=>setCodeInput(e.target.value.toUpperCase())}/><button disabled={busy||!isConfigured} onClick={()=>void joinRoom()}>Join ↗</button></div></div>
        {stats && <p className="fine">YOUR STATS · {stats.games_played} GAMES · {stats.crew_wins} CREW WINS · {stats.impostor_wins} IMPOSTOR WINS</p>}
      </div><div className="features"><div><b>01</b><span><strong>Secret words</strong><small>One word. Two sides.</small></span></div><div><b>02</b><span><strong>Give clues</strong><small>Say enough, not too much.</small></span></div><div><b>03</b><span><strong>Vote to expose</strong><small>Trust your instincts.</small></span></div></div>
    </section> : <section className="hero room-view">
      <p className="eyebrow">ROOM {game.room.code} · ROUND {game.room.round}</p>
      <h1>{phase === "lobby" ? "Gather your crew." : phase === "results" ? "The shadows settle." : phase === "guess" ? "One final guess." : phase === "voting" ? "Choose carefully." : phase === "discussion" ? "Read the room." : "Your word is your weapon."}</h1>
      <p className="intro">{phase === "lobby" ? "Share the code. You need 4 to 8 players to begin." : "Room updates live. Keep your role and secret word private."}</p>
      <div className="panel">
        <div className="room-code">{game.room.code}</div>
        <div className="phase-banner"><div className="phase-orb"><span>◈</span></div><div className="phase-copy"><p className="eyebrow">CURRENT PHASE</p><h2>{waitingTitle}</h2><p>{phase === "lobby" ? "Invite your crew. The game begins when the host is ready." : phase === "clue" ? `${submittedClues} of ${playerTotal} players have submitted clues.` : phase === "voting" ? "Choose carefully. Votes stay hidden until the reveal." : phase === "discussion" ? "Compare clues and look for the odd one out." : phase === "guess" ? "Can the impostor name the crew's word?" : phase === "results" ? "The round is complete. Review the outcome below." : "Waiting for the room to update."}</p></div><div className="live-pulse"><i /> LIVE</div></div>
        <div className="panel-head"><span className="mini-icon">✦</span><div><h2>{game.you.name}{game.you.is_host ? " · HOST" : ""}</h2><p>{game.room.player_count} players · {phase?.toUpperCase()}</p></div></div>
        {phase === "lobby" && <><h2>Players</h2><ul className="players">{game.players.map(p=><li key={p.player_id}><span>{p.name}{p.is_host?" · HOST":""}</span><span>{p.alive?"●":"○"}</span></li>)}</ul><button className="primary" disabled={busy||!game.you.is_host||game.room.player_count<4} onClick={()=>void act({action:"start_game",code:game.room.code,token})}>{game.you.is_host ? (game.room.player_count<4?"Waiting for 4 players":"Start game"):"Waiting for host"} <span>↗</span></button></>}
        {phase !== "lobby" && <div className="secret"><p className="eyebrow">YOUR ROLE</p><h2>{game.you.role?.toUpperCase() ?? "UNKNOWN"}</h2><p className="word">{game.you.word ?? "Word hidden"}</p><p className="fine">Keep this word secret. Impostors receive a decoy word.</p></div>}
        {phase === "clue" && game.you.alive && !game.players.find(p=>p.player_id===game.you.player_id)?.has_clued && <div className="action-form"><label>YOUR CLUE</label><input className="text-input" maxLength={120} placeholder="Give a subtle clue..." value={clue} onChange={e=>setClue(e.target.value)}/><button className="primary" disabled={busy||!clue.trim()} onClick={()=>void sendClue()}>Submit clue <span>↗</span></button></div>}
        {phase === "clue" && game.you.is_host && <button className="secondary" disabled={busy} onClick={()=>void act({action:"begin_voting",code:game.room.code,token})}>Move to discussion / voting</button>}
        {(phase === "discussion" || phase === "voting") && <div className="clues"><h2>Clues from the crew</h2>{game.players.filter(p=>p.clue).map(p=><p key={p.player_id}><strong>{p.name}:</strong> {p.clue}</p>)}{game.players.every(p=>!p.clue)&&<p className="muted">No clues submitted yet.</p>}</div>}
        {phase === "voting" && game.you.alive && <div className="action-form"><label>CAST YOUR VOTE <span className="vote-private">PRIVATE BALLOT</span></label><p className="vote-hint">Who feels out of place? Select a player to lock in your choice.</p><div className="vote-grid">{game.players.filter(p=>p.alive&&p.player_id!==game.you.player_id).map((p,i)=><button type="button" key={p.player_id} className={`vote-card ${target===p.player_id?"selected":""}`} disabled={busy||voteSubmitted} aria-pressed={target===p.player_id} onClick={()=>setTarget(p.player_id)}><span className="vote-avatar">{p.name.trim().charAt(0).toUpperCase()}</span><span className="vote-name">{p.name}</span><span className="vote-select">{target===p.player_id?"✓":"＋"}</span></button>)}</div>{voteSubmitted ? <div className="vote-locked"><span>✓</span><div><strong>Vote sealed</strong><small>Your choice is locked in. Waiting for the crew...</small></div></div> : <button className="primary" disabled={busy||!target} onClick={async()=>{const ok=await act({action:"vote",code:game.room.code,token,target_player_id:target});if(ok)setVoteSubmitted(true)}}>Seal my vote <span>↗</span></button>}<p className="vote-footnote">Your vote stays secret until the reveal.</p></div>}
        {phase === "guess" && game.you.role === "impostor" && <div className="action-form"><label>GUESS THE CREW'S SECRET WORD</label><input className="text-input" value={guess} onChange={e=>setGuess(e.target.value)} placeholder="Your final guess..." maxLength={60}/><button className="primary" disabled={busy||!guess.trim()} onClick={()=>void act({action:"guess_secret",code:game.room.code,token,guess:guess.trim()})}>Make final guess <span>↗</span></button></div>}
        {phase === "results" && <div className="secret"><p className="eyebrow">WINNER</p><h2>{game.room.winner?.toUpperCase() ?? "ROUND COMPLETE"}</h2><p className="word">Secret: {game.room.secret_word ?? "hidden"}</p><button className="primary" disabled={busy||!game.you.is_host} onClick={()=>void act({action:"start_game",code:game.room.code,token})}>Play another round <span>↗</span></button></div>}
        <div className="waiting-strip"><span className="waiting-dots"><i></i><i></i><i></i></span><span>{phase === "lobby" ? `${Math.max(0, 4-playerTotal)} more player${4-playerTotal===1?"":"s"} needed to start` : phase === "clue" ? "Waiting for everyone to share a clue" : phase === "discussion" ? "Use this time to compare stories" : phase === "voting" ? "Votes are private until the reveal" : phase === "guess" ? "The final guess decides the round" : "Ready for another round?"}</span></div><div className="players-wrap"><h2>Crew <span className="count-pill">{playerTotal} PLAYERS</span></h2><ul className="players">{game.players.map(p=><li key={p.player_id}><span>{p.name}{p.is_host?" · HOST":""}{p.player_id===game.you.player_id?" · YOU":""}</span><span>{p.alive?"●":"ELIMINATED"}</span></li>)}</ul></div>
        {phase !== "lobby" && phase !== "results" && <div className="chat-box"><h2>Room chat</h2><div className="chat-list">{game.chat.slice(-30).map((m,i)=><p key={i}><strong>{m.name}:</strong> {m.message}</p>)}</div><div className="join"><div><input aria-label="Chat message" placeholder="Say something..." value={message} maxLength={300} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void sendMessage()}}/><button disabled={busy||!message.trim()} onClick={()=>void sendMessage()}>Send</button></div></div></div>}
        <button className="secondary" disabled={busy} onClick={()=>void act({action:"leave_room",code:game.room.code,token})}>Leave room</button>
      </div>
    </section>}
    {error && <div className="error-toast" role="alert">{error}<button onClick={()=>setError("")}>×</button></div>}
    <footer><span>SHADOW IMPOSTOR © 2026</span><span>WATCH YOUR WORDS <b>●</b></span></footer>
  </main>;
}