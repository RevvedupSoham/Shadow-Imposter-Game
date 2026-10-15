import { useState } from "react";

export default function App() {
  const [players, setPlayers] = useState(4);
  const [roomCode, setRoomCode] = useState("");
  const [created, setCreated] = useState(false);

  return <main className="shell">
    <div className="glow glow-one" /><div className="glow glow-two" />
    <header><span className="mark">◈</span><span>SHADOW<span className="accent"> IMPOSTOR</span></span><span className="status"><i /> SOCIAL DEDUCTION</span></header>
    <section className="hero"><p className="eyebrow">TRUST IS A LIMITED RESOURCE</p><h1>Someone here<br /><span>is not one of you.</span></h1><p className="intro">Share clues. Read the room. Find the impostor before they find you.</p>
      <div className="panel"><div className="panel-head"><span className="mini-icon">✦</span><div><h2>{created ? "Your lobby is ready" : "Start a new game"}</h2><p>{created ? "Share this code with your crew." : "Gather your crew and enter the shadows."}</p></div></div>
      {!created ? <><label htmlFor="players">PLAYERS <strong>{players}</strong></label><input id="players" type="range" min="4" max="8" value={players} onChange={e => setPlayers(Number(e.target.value))} /><div className="range-labels"><span>4 PLAYERS</span><span>8 PLAYERS</span></div><button className="primary" onClick={() => { setRoomCode(Math.random().toString(36).slice(2, 8).toUpperCase()); setCreated(true); }}>Create room <span>↗</span></button><p className="fine">NO ACCOUNT NEEDED · FREE TO PLAY</p></> : <><div className="room-code">{roomCode}</div><button className="primary" onClick={() => navigator.clipboard?.writeText(roomCode)}>Copy room code <span>▣</span></button><button className="secondary" onClick={() => setCreated(false)}>Back</button></>}
      <div className="join"><span>ALREADY HAVE A CODE?</span><div><input aria-label="Room code" placeholder="ENTER CODE" maxLength={6} value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} /><button onClick={() => setCreated(true)}>Join ↗</button></div></div>
      </div><div className="features"><div><b>01</b><span><strong>Secret words</strong><small>One word. Two sides.</small></span></div><div><b>02</b><span><strong>Give clues</strong><small>Say enough, not too much.</small></span></div><div><b>03</b><span><strong>Vote to expose</strong><small>Trust your instincts.</small></span></div></div>
    </section><footer><span>SHADOW IMPOSTOR © 2026</span><span>WATCH YOUR WORDS <b>●</b></span></footer>
  </main>;
}
