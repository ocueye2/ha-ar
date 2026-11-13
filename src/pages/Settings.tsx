import { useState } from 'react';
import { ArrowLeft, Link2, LogOut, Save } from 'lucide-react';
type Props = { hassUrl: string; connected: boolean; error?: string; onSave: (url: string) => void; onDisconnect: () => void; onBack: () => void };
export function Settings({ hassUrl, connected, error, onSave, onDisconnect, onBack }: Props) {
 const [url,setUrl] = useState(hassUrl);
 return <main className="page"><header className="page-header"><button className="icon-button" onClick={onBack}><ArrowLeft/></button><div><span className="eyebrow">PREFERENCES</span><h1>Settings</h1></div></header>
 <section className="settings-card"><h3><Link2 size={18}/> Home Assistant</h3><p>Connect to your Home Assistant instance. Use its full URL, including https:// when using a secure reverse proxy. The first connect takes you to Home Assistant to authorize, then brings you back here — that round trip is normal.</p><label className="field-label">INSTANCE URL</label><input className="text-input" placeholder="https://home.example.com" value={url} onChange={e=>setUrl(e.target.value)}/><button className="primary-button" onClick={()=>onSave(url.trim())}><Save size={17}/> Save and connect</button>{error&&<p className="error-text">{error}</p>}<div className="connection-state"><span className={`status-dot ${connected?'online':''}`}/>{connected?'Connected':'Not connected'}</div>{(connected||hassUrl)&&<button className="danger-button" onClick={onDisconnect}><LogOut size={16}/> {connected?'Disconnect':'Clear saved sign-in'}</button>}</section>
 <section className="settings-card"><h3>Camera and privacy</h3><p>Camera video is processed in your browser. Reference images and AR target data stay in this browser's local storage. No camera feed is sent to a server.</p><p className="warning-note">Camera access requires HTTPS (or localhost). Your Home Assistant URL must allow this website as an OAuth redirect origin / CORS origin when hosted on a different domain.</p></section>
 </main>;
}
