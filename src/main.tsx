import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Connection } from 'home-assistant-js-websocket';
import { CameraPage } from './pages/Camera';
import { Devices } from './pages/Devices';
import { Settings } from './pages/Settings';
import { connectHomeAssistant, disconnect } from './lib/homeAssistant';
import { loadConfig, saveConfig } from './lib/storage';
import type { ARDevice, EntityState } from './types';
import './style.css';
function App(){
 const [config,setConfig]=useState(loadConfig);const [entities,setEntities]=useState<Record<string,EntityState>>({});const [connection,setConnection]=useState<Connection|null>(null);const [page,setPage]=useState<'camera'|'devices'|'settings'>('camera');const [connecting,setConnecting]=useState(false);const [status,setStatus]=useState('');
 const persist=(next:typeof config)=>{setConfig(next);saveConfig(next)};
 const connect=async(url:string)=>{if(!url)return;setConnecting(true);setStatus('Connecting to Home Assistant…');try{const result=await connectHomeAssistant(url,(states:Record<string,EntityState>)=>setEntities(states));setConnection(result.connection);persist({...config,hassUrl:url});setStatus('Connected');}catch(e){setStatus(e instanceof Error?e.message:'Connection failed');}finally{setConnecting(false);}};
 useEffect(()=>{if(config.hassUrl)connect(config.hassUrl);return()=>{disconnect(connection??undefined)};},[]);
 const saveDevices=(devices:ARDevice[],compiledTarget:string)=>persist({...config,devices,compiledTarget});
 const disconnectHA=()=>{disconnect(connection??undefined);setConnection(null);setEntities({});localStorage.removeItem('ha-ar-auth-tokens');setStatus('Disconnected');};
 const openDevice=(d:ARDevice)=>{setPage('camera');};
 return <>{page==='camera'?<CameraPage devices={config.devices} entities={entities} connection={connection} target={config.compiledTarget??''} onSettings={()=>setPage('settings')} onDevices={()=>setPage('devices')}/>:page==='devices'?<Devices devices={config.devices} entities={entities} onSave={saveDevices} onBack={()=>setPage('camera')} onOpen={openDevice}/>:<Settings hassUrl={config.hassUrl} connected={!!connection} onSave={connect} onDisconnect={disconnectHA} onBack={()=>setPage('camera')}/>}{(connecting||status)&&<div className="toast" onClick={()=>setStatus('')}>{connecting?'Connecting…':status}</div>}</>;
}

createRoot(document.getElementById('root')!).render(<App/>);
