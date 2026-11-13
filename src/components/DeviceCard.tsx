import { Power, Sun, Thermometer, ChevronRight, Circle } from 'lucide-react';
import type { ARDevice, EntityState } from '../types';
type Props = { device: ARDevice; entity?: EntityState; onOpen: () => void };
export function DeviceCard({ device, entity, onOpen }: Props) {
  const on = entity?.state === 'on' || entity?.state === 'playing' || entity?.state === 'open';
  return <button className="device-card" onClick={onOpen}>
    <div className="device-thumb">{device.imageData ? <img src={device.imageData} /> : <Power />}</div>
    <div className="device-info"><strong>{device.name}</strong><span>{device.entityId}</span><small><Circle size={7} fill={entity ? (on ? '#43a982' : '#89969b') : 'none'} /> {entity?.state ?? 'Not connected'}</small></div>
    <ChevronRight className="muted" size={19}/>
  </button>;
}
