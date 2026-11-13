import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Connection } from 'home-assistant-js-websocket';
import { CameraPage } from './pages/Camera';
import { Devices } from './pages/Devices';
import { Settings } from './pages/Settings';
import { connectHomeAssistant, disconnect, clearStoredTokens, clearAuthCallbackFromUrl, hasStoredTokens, hasAuthCallback, describeConnectError } from './lib/homeAssistant';
import { loadConfig, saveConfig } from './lib/storage';
import type { ARDevice, EntityState } from './types';
import './style.css';
function App(){
 const [config,setConfig]=useState(loadConfig);const [entities,setEntities]=useState<Record<string,EntityState>>({});const [connection,setConnection]=useState<Connection|null>(null);const [page,setPage]=useState<'camera'|'devices'|'settings'>('camera');const [connecting,setConnecting]=useState(false);const [status,setStatus]=useState('');
 const connectionRef=useRef<Connection|null>(null);const unsubscribeRef=useRef<(() => void)|null>(null);const connectingRef=useRef(false);const configRef=useRef(config);configRef.current=config;
 const persist=(next:typeof config)=>{configRef.current=next;setConfig(next);saveConfig(next)};
 const disconnectCurrent=()=>{try{unsubscribeRef.current?.();}catch{}unsubscribeRef.current=null;const c=connectionRef.current;connectionRef.current=null;setConnection(null);if(c)disconnect(c);};
 const connect=async(url:string)=>{
  if(!url||connectingRef.current)return;
  connectingRef.current=true;setConnecting(true);
  // First sign-in leaves this page for Home Assistant's authorize screen and
  // comes back; say so instead of a bare "Connecting…" so it does not look stuck.
  setStatus(!hasStoredTokens()&&!hasAuthCallback()?'Opening Home Assistant to sign in…':'Connecting to Home Assistant…');
  disconnectCurrent();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Connection timed out. Is Home Assistant reachable at that URL?')),25000);});
   const result=await Promise.race([connectHomeAssistant(url,(states:Record<string,EntityState>)=>setEntities(states)),timeout]);
   connectionRef.current=result.connection;unsubscribeRef.current=result.unsubscribe;setConnection(result.connection);persist({...configRef.current,hassUrl:url});setStatus('Connected');
  }catch(e){setStatus(describeConnectError(e));}
  finally{clearTimeout(timer);connectingRef.current=false;setConnecting(false);}
 };
 useEffect(()=>{if(configRef.current.hassUrl)connect(configRef.current.hassUrl);return()=>{disconnectCurrent();};},[]);
 const saveDevices=(devices:ARDevice[],compiledTarget:string)=>persist({...configRef.current,devices,compiledTarget});
 const disconnectHA=()=>{disconnectCurrent();setEntities({});clearStoredTokens();clearAuthCallbackFromUrl();setStatus('Disconnected');};
 const openDevice=(d:ARDevice)=>{setPage('camera');};
 const error=status!==''&&status!=='Connected'&&status!=='Disconnected'&&status!=='Connecting to Home Assistant…'&&status!=='Opening Home Assistant to sign in…'?status:'';
 return <>{page==='camera'?<CameraPage devices={config.devices} entities={entities} connection={connection} target={config.compiledTarget??''} onSettings={()=>setPage('settings')} onDevices={()=>setPage('devices')}/>:page==='devices'?<Devices devices={config.devices} entities={entities} onSave={saveDevices} onBack={()=>setPage('camera')} onOpen={openDevice}/>:<Settings hassUrl={config.hassUrl} connected={!!connection} error={error} onSave={connect} onDisconnect={disconnectHA} onBack={()=>setPage('camera')}/>}{(connecting||status)&&<div className="toast" onClick={()=>setStatus('')}>{status||'Connecting…'}</div>}</>;
}

createRoot(document.getElementById('root')!).render(<App/>);
