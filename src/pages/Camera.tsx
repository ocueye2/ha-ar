import { useEffect, useRef, useState } from 'react';
import { Camera as CameraIcon, Scan, Settings2, X, AlertTriangle } from 'lucide-react';
import type { ARDevice, EntityState } from '../types';
import type { Connection } from 'home-assistant-js-websocket';
import { ControlPanel } from '../components/ControlPanel';
import { DetectionHold } from '../lib/detectionHold';
type Props={devices:ARDevice[];entities:Record<string,EntityState>;connection:Connection|null;target:string;onSettings:()=>void;onDevices:()=>void};
export function CameraPage({devices,entities,connection,target,onSettings,onDevices}:Props){
 const host=useRef<HTMLDivElement>(null);const [started,setStarted]=useState(false),[found,setFound]=useState<number|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const holdRef=useRef(new DetectionHold());const clearTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancelClear=()=>{if(clearTimer.current){clearTimeout(clearTimer.current);clearTimer.current=null;}};
 const closePanel=()=>{cancelClear();holdRef.current.clear();setFound(null);};
 useEffect(()=>{let ar:any;let active=true;let onFound:(e:any)=>void;let onLost:(e:any)=>void;
  const start=async()=>{if(!host.current||!target||!devices.length)return;setLoading(true);setError('');try{const {MindARThree}=await import('mind-ar/dist/mindar-image-three.prod.js');const THREE=await import('three');if(!active)return;ar=new MindARThree({container:host.current,imageTargetSrc:target,maxTrack:1,uiLoading:'no',uiScanning:'no',uiError:'no'});const {renderer,scene,camera}=ar;const geometry=new THREE.RingGeometry(0.18,0.21,48);const material=new THREE.MeshBasicMaterial({color:0x18a999,side:THREE.DoubleSide});devices.forEach((device,index)=>{const anchor=ar.addAnchor(index);const ring=new THREE.Mesh(geometry,material);ring.position.set(0,0,0.01);anchor.group.add(ring);onFound=()=>{cancelClear();holdRef.current.found(index);setFound(index);setStarted(true)};onLost=()=>{const remaining=holdRef.current.lost(index);if(remaining===null)return;if(remaining<=0){holdRef.current.clear();setFound(null);return;}cancelClear();clearTimer.current=setTimeout(()=>{holdRef.current.clear();setFound(null);},remaining);};anchor.onTargetFound=onFound;anchor.onTargetLost=onLost;});await ar.start();if(active){setStarted(true);setLoading(false);}}catch(e){setError(e instanceof Error?e.message:'Unable to start camera. Check HTTPS and camera permission.');setLoading(false);}};
  start();return()=>{active=false;cancelClear();holdRef.current.clear();try{ar?.stop();}catch{};};
 },[target,devices.length]);
 const selected=found===null?null:devices[found];
 return <main className="camera-page"><div className="camera-host" ref={host}/><header className="camera-top"><div className="brand-mark"><span className="ha-mark">⌂</span><div><strong>Home Assistant</strong><small>AR CONTROL</small></div></div><div className="camera-top-actions"><button className="camera-icon" onClick={onDevices}><Scan/></button><button className="camera-icon" onClick={onSettings}><Settings2/></button></div></header>
 {!started&&<div className="camera-intro"><div className="camera-symbol"><CameraIcon size={30}/></div><h1>Point at a device</h1><p>{devices.length?'Move your camera slowly until a saved reference image is recognized.':'Add your first device and its reference image to begin.'}</p>{!devices.length&&<button className="primary-button" onClick={onDevices}>Set up devices</button>}</div>}
 {loading&&<div className="camera-status"><span className="spinner"/> Starting camera…</div>}
 {error&&<div className="camera-error"><AlertTriangle/><span>{error}</span><button onClick={()=>location.reload()}><X size={16}/></button></div>}
 {started&&<div className="scan-hint"><span className="live-dot"/> {selected?'Device recognized':'Scanning for saved devices'}</div>}
 {selected&&connection&&<ControlPanel device={selected} entity={entities[selected.entityId]} connection={connection} onClose={closePanel}/>}
 <footer className="camera-bottom"><button onClick={onDevices}><Scan/><span>Devices</span></button><span className="camera-tip">{devices.length} image target{devices.length===1?'':'s'} loaded</span><button onClick={onSettings}><Settings2/><span>Settings</span></button></footer>
 </main>;
}
