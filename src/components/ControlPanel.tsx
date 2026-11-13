import { useState } from 'react';
import { Power, Sun, Thermometer, X, Palette, Play, Pause, ChevronUp, ChevronDown } from 'lucide-react';
import type { ARDevice, EntityState } from '../types';
import type { Connection } from 'home-assistant-js-websocket';
import { service } from '../lib/homeAssistant';
type Props = { device: ARDevice; entity?: EntityState; connection: Connection; onClose: () => void };
export function ControlPanel({ device, entity, connection, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attrs = entity?.attributes ?? {};
  const domain = device.entityId.split('.')[0];
  const run = async (serviceName: string, data: Record<string, unknown> = {}) => {
    setBusy(true); setError('');
    try { await service(connection, device.entityId, domain, serviceName, data); }
    catch (e) { setError(e instanceof Error ? e.message : 'Command failed'); }
    finally { setBusy(false); }
  };
  const toggle = () => run(entity?.state === 'on' || entity?.state === 'playing' ? 'turn_off' : 'turn_on');
  const brightness = Number(attrs.brightness ?? 0);
  const isLight = domain === 'light';
  const isClimate = domain === 'climate';
  const isCover = domain === 'cover';
  const isMedia = domain === 'media_player';
  return <section className="control-panel" aria-label={`${device.name} controls`}>
    <div className="panel-grabber"/><header className="panel-head"><div><span className="eyebrow">DETECTED DEVICE</span><h2>{device.name}</h2><p>{entity?.state ?? 'Waiting for Home Assistant'}</p></div><button className="icon-button" onClick={onClose}><X/></button></header>
    <div className="panel-actions">
      {!isClimate && !isCover && !isMedia && <button className={`power-control ${entity?.state === 'on' ? 'active' : ''}`} disabled={busy || !entity} onClick={toggle}><Power size={22}/><span>{entity?.state === 'on' ? 'Turn off' : 'Turn on'}</span></button>}
      {isClimate && <><div className="value-row"><Thermometer/><strong>{attrs.current_temperature ?? '--'}°</strong><span>Current</span></div><label className="field-label">TARGET TEMPERATURE <b>{attrs.temperature ?? '--'}°</b></label><input type="range" min={attrs.min_temp ?? 7} max={attrs.max_temp ?? 35} step="0.5" value={attrs.temperature ?? 20} onChange={e => run('set_temperature', { temperature: Number(e.target.value) })}/><select value={attrs.hvac_mode ?? 'off'} onChange={e => run('set_hvac_mode', { hvac_mode: e.target.value })}>{(attrs.hvac_modes ?? ['off','heat','cool','auto']).map((m: string) => <option key={m}>{m}</option>)}</select></>}
      {isLight && <><label className="field-label"><span><Sun size={15}/> BRIGHTNESS</span><b>{Math.round(brightness / 255 * 100)}%</b></label><input type="range" min="1" max="255" value={brightness || 1} onChange={e => run('turn_on', { brightness: Number(e.target.value) })}/><button className="secondary-action" onClick={() => run('turn_on', { color_temp_kelvin: 3000 })}><Palette size={17}/> Warm white</button></>}
      {isCover && <div className="cover-actions"><button onClick={() => run('open_cover')}><ChevronUp/> Open</button><button onClick={() => run('stop_cover')}>Stop</button><button onClick={() => run('close_cover')}><ChevronDown/> Close</button></div>}
      {isMedia && <div className="cover-actions"><button onClick={() => run('media_play')}><Play/> Play</button><button onClick={() => run('media_pause')}><Pause/> Pause</button><button onClick={() => run('media_stop')}>Stop</button></div>}
    </div>
    {error && <p className="error-text">{error}</p>}
    <div className="panel-foot"><span className="live-dot"/> Live from Home Assistant <span>{busy ? 'Sending…' : 'Synced'}</span></div>
  </section>;
}
