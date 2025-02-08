import React, { useEffect, useState, useRef, useMemo } from 'react';
import { TimingObject } from 'timing-object';
import Peer from 'peerjs';
import { Clock, Signal, Users, ArrowDownLeft, ArrowUpRight } from 'lucide-react';

const PEERJS_CONFIG = {
  host: "peerjs-server-t8z8.onrender.com",
  path: "/ddmbsync",
  key: "realtime",
  debug: 1,
  port: 443,
  secure: true,
};

const CYCLE_DURATION = 30;
const PEER_DISCONNECT_LINGER = 8000; // 8 seconds to show disconnected peers
const LOREM_IPSUM = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`;

interface PeerLatency {
  id: string;
  latency: number;
  lastUpdate: number;
  direction: 'incoming' | 'outgoing';
  disconnected?: boolean;
  disconnectTime?: number;
}

interface TimingUpdate {
  timestamp: number;
  peerId: string;
  position: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function generateLoremColumns(totalWidth: number): string[] {
  const columnWidth = 540;
  const numColumns = Math.floor(totalWidth / columnWidth);
  return Array.from({ length: numColumns }, () => LOREM_IPSUM);
}

function generatePastelColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const h = hash % 360;
  return `hsl(${h}, 70%, 80%)`;
}

const PeerChip: React.FC<{ peerId: string; className?: string }> = ({ peerId, className = '' }) => {
  const bgColor = useMemo(() => generatePastelColor(peerId), [peerId]);
  const textColor = 'black';
  
  return (
    <span 
      className={`inline-block px-2 py-0.5 rounded-full font-mono text-xs ${className}`}
      style={{
        backgroundColor: bgColor,
        color: textColor,
        maxWidth: '300px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
    >
      {peerId}
    </span>
  );
};

function App() {
  const [clockTime, setClockTime] = useState<number>(0);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [totalPeers, setTotalPeers] = useState<number>(0);
  const [peerLatencies, setPeerLatencies] = useState<PeerLatency[]>([]);
  const [nextEvent, setNextEvent] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(0);
  const [backgroundColor, setBackgroundColor] = useState<string>('#EE2D29');
  const [displayText, setDisplayText] = useState<string>('BURGERS');
  const [showImage, setShowImage] = useState<boolean>(false);
  const [showColumns, setShowColumns] = useState<boolean>(false);
  const [showAlternatingColumns, setShowAlternatingColumns] = useState<boolean>(false);
  const [slidePosition, setSlidePosition] = useState<'left' | 'center'>('left');
  const [slideDirection, setSlideDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [columnsRolling, setColumnsRolling] = useState<boolean>(true);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [peerId, setPeerId] = useState<string>('');
  const [connectionStartTime, setConnectionStartTime] = useState<number>(0);
  const [lastTimingUpdate, setLastTimingUpdate] = useState<TimingUpdate | null>(null);
  const [allPeers, setAllPeers] = useState<string[]>([]);
  
  const timingObject = useRef<TimingObject>();
  const peer = useRef<Peer>();
  const connections = useRef<Map<string, { conn: Peer.DataConnection; direction: 'incoming' | 'outgoing' }>>(new Map());
  const animationFrameRef = useRef<number>();
  const startTime = useRef<number>(Date.now());
  const latencyInterval = useRef<NodeJS.Timeout>();
  const imageRef = useRef<HTMLImageElement>(null);

  const leftOffset = window.location.hash ? 
    parseInt(window.location.hash.replace(/.*leftoffset=(\d+).*/, '$1'), 10) : 0;
  const totalWidth = window.location.hash ?
    parseInt(window.location.hash.replace(/.*totalwidth=(\d+).*/, '$1'), 10) : window.innerWidth;
  
  const loremColumns = useRef(generateLoremColumns(totalWidth));
  const useTextColumns = totalWidth <= 5400;

  const urlParams = new URLSearchParams(window.location.hash.slice(1));
  const showStatusBox = urlParams.get('statusbox') !== 'false';

  const extractPeerIdFromLog = (log: string): string | null => {
    const match = log.match(/MENUSYNC_[a-zA-Z0-9]+/);
    return match ? match[0] : null;
  };

  const updatePeerCount = () => {
    const activeConnections = peerLatencies.filter(p => !p.disconnected).length;
    setPeerCount(activeConnections);
  };

  const logMessage = (message: string) => {
    setConsoleLogs(prev => {
      // Don't add if it's the same as the last message
      if (prev.length > 0 && prev[prev.length - 1] === message) {
        return prev;
      }
      return [...prev.slice(-4), message];
    });
  };

  useEffect(() => {
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      originalConsoleLog.apply(console, args);
      const message = args.join(' ');
      if (!message.includes('Received timing sync from peer')) {
        logMessage(message);
      }
    };
    return () => {
      console.log = originalConsoleLog;
    };
  }, []);

  const broadcastTimingState = () => {
    if (!timingObject.current) return;
    
    const state = timingObject.current.query();
    const update = {
      type: 'sync-broadcast',
      state,
      sourcePeerId: peerId,
      timestamp: Date.now()
    };
    
    connections.current.forEach(({ conn }) => {
      conn.send(update);
    });
  };

  const checkPeerRegistration = async (peerId: string): Promise<boolean> => {
    try {
      const response = await fetch(`https://peerjs-server-t8z8.onrender.com/ddmbsync/peerjs/peers`);
      const peers = await response.json();
      return peers.includes(peerId);
    } catch (error) {
      console.log(`Failed to check peer registration: ${error}`);
      return false;
    }
  };

  const setupConnection = async (conn: Peer.DataConnection, direction: 'incoming' | 'outgoing') => {
    const isRegistered = await checkPeerRegistration(conn.peer);
    if (!isRegistered) {
      console.log(`Closing connection to unregistered peer: ${conn.peer}`);
      conn.close();
      return;
    }

    const existingConn = connections.current.get(conn.peer);
    if (existingConn) {
      console.log('Closing existing connection to: ' + conn.peer);
      existingConn.conn.close();
      connections.current.delete(conn.peer);
    }

    conn.on('open', () => {
      connections.current.set(conn.peer, { conn, direction });
      setPeerLatencies(prev => {
        const newLatencies = [
          ...prev.filter(p => p.id !== conn.peer), 
          { 
            id: conn.peer, 
            latency: 0, 
            lastUpdate: Date.now(), 
            direction,
            disconnected: false 
          }
        ];
        return newLatencies;
      });
      updatePeerCount();
      
      const start = Date.now();
      conn.send({ type: 'ping', time: start });
      conn.send({ type: 'sync-request' });
    });

    conn.on('data', (data: any) => {
      if (data.type === 'ping') {
        conn.send({ type: 'pong', time: data.time });
      } else if (data.type === 'pong') {
        const latency = Date.now() - data.time;
        setPeerLatencies(prev => prev.map(p => 
          p.id === conn.peer 
            ? { ...p, latency, lastUpdate: Date.now() } 
            : p
        ));
      } else if (data.type === 'sync-request') {
        if (timingObject.current) {
          const state = timingObject.current.query();
          conn.send({ 
            type: 'sync-response',
            state,
            sourcePeerId: peerId,
            timestamp: Date.now()
          });
        }
      } else if (data.type === 'sync-response' || data.type === 'sync-broadcast') {
        if (timingObject.current) {
          timingObject.current.update(data.state);
          
          setLastTimingUpdate({
            timestamp: data.timestamp,
            peerId: data.sourcePeerId || conn.peer,
            position: data.state.position
          });

          if (data.type === 'sync-response') {
            connections.current.forEach(({ conn: otherConn }) => {
              if (otherConn !== conn) {
                otherConn.send({
                  type: 'sync-broadcast',
                  state: data.state,
                  sourcePeerId: data.sourcePeerId,
                  timestamp: data.timestamp
                });
              }
            });
          }
        }
      }
    });

    conn.on('close', () => {
      const now = Date.now();
      connections.current.delete(conn.peer);
      setPeerLatencies(prev => {
        const newLatencies = prev.map(p => 
          p.id === conn.peer 
            ? { ...p, disconnected: true, disconnectTime: now }
            : p
        );
        return newLatencies;
      });
      updatePeerCount();
      console.log('Peer disconnected: ' + conn.peer);
    });
  };

  useEffect(() => {
    timingObject.current = new TimingObject({
      timestamp: Date.now() / 1000,
      position: 0,
      velocity: 1,
      acceleration: 0
    });
    
    const peerId = `MENUSYNC_${Math.random().toString(36).substr(2, 9)}`;
    peer.current = new Peer(peerId, PEERJS_CONFIG);
    
    peer.current.on('open', (id) => {
      setPeerId(id);
      setConnectionStartTime(Date.now());
      console.log('Connected to signaling server with ID: ' + id);
      
      const discoveryInterval = setInterval(() => {
        peer.current?.listAllPeers((peerList) => {
          const menuSyncPeers = peerList.filter(pid => pid.startsWith('MENUSYNC_'));
          setTotalPeers(menuSyncPeers.length);
          setAllPeers(menuSyncPeers);

          menuSyncPeers.forEach(newPeerId => {
            if (newPeerId !== peerId && !connections.current.has(newPeerId)) {
              console.log(`Initiating connection to peer: ${newPeerId}`);
              const conn = peer.current?.connect(newPeerId);
              if (conn) setupConnection(conn, 'outgoing');
            }
          });
        });
      }, 5000);

      latencyInterval.current = setInterval(() => {
        connections.current.forEach(({ conn }) => {
          const start = Date.now();
          conn.send({ type: 'ping', time: start });
        });
      }, 2000);

      const syncInterval = setInterval(() => {
        if (connections.current.size > 0) {
          broadcastTimingState();
        }
      }, 5000);

      return () => {
        clearInterval(discoveryInterval);
        clearInterval(syncInterval);
        if (latencyInterval.current) clearInterval(latencyInterval.current);
      };
    });

    peer.current.on('connection', (conn) => {
      if (!conn.peer.startsWith('MENUSYNC_')) {
        console.log('Rejected non-MENUSYNC peer: ' + conn.peer);
        conn.close();
        return;
      }

      if (conn.peer > peerId) {
        console.log('Rejected duplicate connection from: ' + conn.peer);
        conn.close();
        return;
      }
      
      console.log('Accepting connection from: ' + conn.peer);
      setupConnection(conn, 'incoming');
    });

    const updateAnimation = () => {
      if (!timingObject.current) return;

      const query = timingObject.current.query();
      const position = query.position || 0;
      const adjustedPosition = position % CYCLE_DURATION;
      
      setClockTime(Date.now());
      
      if (adjustedPosition < 3) {
        setBackgroundColor('#EE2D29');
        setDisplayText('BURGERS');
        setShowImage(false);
        setShowColumns(false);
        setShowAlternatingColumns(false);
        setColumnsRolling(true);
        setSlidePosition(adjustedPosition < 0.4 ? 'left' : 'center');
        setSlideDirection('horizontal');
        setNextEvent('Content Slide');
        setCountdown(3 - adjustedPosition);
      } else if (adjustedPosition < 15) {
        setBackgroundColor('white');
        setDisplayText('');
        setShowImage(!useTextColumns);
        setShowColumns(useTextColumns);
        setShowAlternatingColumns(false);
        setColumnsRolling(true);
        setSlidePosition(adjustedPosition < 3.4 ? 'left' : 'center');
        setSlideDirection('vertical');
        setNextEvent('CHICKEN');
        setCountdown(15 - adjustedPosition);
      } else if (adjustedPosition < 18) {
        setBackgroundColor('black');
        setDisplayText('CHICKEN');
        setShowImage(false);
        setShowColumns(false);
        setShowAlternatingColumns(false);
        setColumnsRolling(true);
        setSlidePosition(adjustedPosition < 15.4 ? 'left' : 'center');
        setSlideDirection('horizontal');
        setNextEvent('Columns');
        setCountdown(18 - adjustedPosition);
      } else {
        setBackgroundColor('white');
        setDisplayText('');
        setShowImage(false);
        setShowColumns(false);
        setShowAlternatingColumns(true);
        setColumnsRolling(false);
        setSlidePosition('center');
        setNextEvent('BURGERS');
        setCountdown(CYCLE_DURATION - adjustedPosition);
      }

      animationFrameRef.current = requestAnimationFrame(updateAnimation);
    };

    updateAnimation();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timingObject.current) {
        timingObject.current.update({ velocity: 0 });
      }
      if (latencyInterval.current) {
        clearInterval(latencyInterval.current);
      }
      peer.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const checkInterval = setInterval(async () => {
      const connectedPeers = Array.from(connections.current.keys());
      for (const connectedPeerId of connectedPeers) {
        const isStillRegistered = await checkPeerRegistration(connectedPeerId);
        if (!isStillRegistered) {
          const connInfo = connections.current.get(connectedPeerId);
          if (connInfo) {
            console.log(`Disconnecting from unregistered peer: ${connectedPeerId}`);
            connInfo.conn.close();
            connections.current.delete(connectedPeerId);
            setPeerCount(prev => connections.current.size);
            const now = Date.now();
            setPeerLatencies(prev => prev.map(p => 
              p.id === connectedPeerId 
                ? { ...p, disconnected: true, disconnectTime: now }
                : p
            ));
          }
        }
      }
    }, 10000);

    return () => clearInterval(checkInterval);
  }, []);

  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      setPeerLatencies(prev => {
        const newLatencies = prev.filter(p => {
          if (p.disconnected) {
            return p.disconnectTime && (now - p.disconnectTime) < PEER_DISCONNECT_LINGER;
          }
          const conn = connections.current.get(p.id);
          return conn && now - p.lastUpdate < 10000;
        });
        return newLatencies;
      });
      updatePeerCount();
    }, 1000);

    return () => clearInterval(cleanup);
  }, []);

  return (
    <div 
      className="relative"
      style={{ 
        backgroundColor,
        marginLeft: `-${leftOffset}px`,
        width: `${totalWidth}px`,
        height: '100vh',
        overflow: 'hidden',
        transition: 'background-color 1s ease-in-out'
      }}
    >
      {showStatusBox && (
        <div className="fixed top-4 left-4 bg-black/80 text-white p-4 rounded-lg font-sans" style={{ width: '500px', zIndex: 1000 }}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock size={16} />
              <span>{new Date(clockTime).toISOString().substr(11, 23)}</span>
            </div>
            
            <div className="border-t border-white/20 pt-2">
              <div>Instance Uptime: {formatDuration(clockTime - startTime.current)}</div>
              <div className="flex items-center gap-2">
                <Signal size={16} />
                <span>Server Connection: {formatDuration(clockTime - connectionStartTime)}</span>
              </div>
              <div className="flex items-center gap-2">
                Peer ID: <PeerChip peerId={peerId} />
              </div>
            </div>
            
            <div className="border-t border-white/20 pt-2">
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} />
                <span>Connected Peers: {peerCount}/{totalPeers}</span>
              </div>
              
              {allPeers.length > 0 && (
                <div className="bg-black/20 rounded p-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left">Peer</th>
                        <th className="text-center">Type</th>
                        <th className="text-right">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allPeers.map(pid => {
                        if (pid === peerId) return null; // Don't show self
                        const peerInfo = peerLatencies.find(p => p.id === pid);
                        return (
                          <tr key={pid} className={peerInfo?.disconnected ? 'opacity-50' : ''}>
                            <td className="pr-2">
                              <span className={peerInfo?.disconnected ? 'line-through' : ''}>
                                <PeerChip peerId={pid} />
                              </span>
                            </td>
                            <td className="text-center">
                              {peerInfo ? (
                                peerInfo.direction === 'incoming' ? (
                                  <ArrowDownLeft size={14} className="inline text-green-400" />
                                ) : (
                                  <ArrowUpRight size={14} className="inline text-blue-400" />
                                )
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="text-right whitespace-nowrap">
                              <span className={peerInfo?.disconnected ? 'line-through' : ''}>
                                {peerInfo ? `${peerInfo.latency}ms` : '-'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            
            <div className="border-t border-white/20 pt-2">
              <div>Next: {nextEvent} in {countdown.toFixed(1)}s</div>
              <div className="w-full bg-gray-200 h-2 mt-2 rounded">
                <div 
                  className="bg-blue-600 h-2 rounded"
                  style={{ width: `${(countdown / 12) * 100}%` }}
                />
              </div>
            </div>

            {lastTimingUpdate && (
              <div className="border-t border-white/20 pt-2">
                <div className="text-sm font-medium mb-1">Last Timing Update:</div>
                <div className="text-sm opacity-80">
                  <div>
                    From: {lastTimingUpdate.peerId === peerId ? 'Self' : (
                      lastTimingUpdate.peerId ? <PeerChip peerId={lastTimingUpdate.peerId} /> : 'Unknown'
                    )}
                  </div>
                  <div>Time: {new Date(lastTimingUpdate.timestamp).toISOString().substr(11, 23)}</div>
                  <div>Position: {lastTimingUpdate.position.toFixed(3)}s</div>
                </div>
              </div>
            )}
            
            <div className="border-t border-white/20 pt-2">
              <div className="text-sm font-medium mb-1">Recent Events:</div>
              <div className="space-y-1">
                {consoleLogs.map((log, index) => {
                  const peerId = extractPeerIdFromLog(log);
                  return (
                    <div key={index} className="text-sm opacity-80 break-all">
                      {peerId ? (
                        <span>
                          {log.split(peerId).map((part, i, arr) => (
                            <React.Fragment key={i}>
                              {part}
                              {i < arr.length - 1 && <PeerChip peerId={peerId} className="mx-1" />}
                            </React.Fragment>
                          ))}
                        </span>
                      ) : (
                        log
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative h-full">
        <img 
          ref={imageRef}
          src="https://storage.googleapis.com/entwined-api-screenshots/f0a0a33f-4ad5-45c6-bbce-353c5a1c0c41.png?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=entwined-api-cloud-run-prod%40entwined-api.iam.gserviceaccount.com%2F20250208%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20250208T140221Z&X-Goog-Expires=86400&X-Goog-SignedHeaders=host&X-Goog-Signature=07eebfc590bb8593a67eb19dc8ee262dd33078a9a5acf03a622b7fcdaec4d570078915dabc9cdc6251e591e2ce90fefe3622676bce056a3ee1479920526a162809b44a5f01d323b44478ae8703937ea34c62901c9bf1344fbae946896adc23f8ac3a9edf3dd246c90e15ed9f0c259010fc2e91feb66e0d900c769df013a764ddf28efcb3279d65bddc34aa2559713961fb5cc9d567e06ec2decfbca99461f22c896f87a7982fde7f7bebd0e7646fb51ec539cb73b300653279fab35d426d5db780d842cba1d106907664cd4ecca9c87e2489397fa11ab5c554c7ea50071519f16990874874077ab1cca6fec102d66d38553cf24e880aa3c9ba89bcc9710aef60"
          alt="Display Image"
          style={{
            width: '7680px',
            height: '1080px',
            objectFit: 'none',
            position: 'absolute',
            top: 0,
            left: 0,
            opacity: showImage ? 1 : 0,
            transition: 'opacity 0.4s ease-in-out',
            pointerEvents: 'none'
          }}
        />

        {showColumns && (
          <div 
            className="absolute inset-0 transition-transform duration-400 ease-in-out"
            style={{
              transform: slideDirection === 'vertical' 
                ? `translateY(${slidePosition === 'left' ? '100%' : '0'})` 
                : 'none'
            }}
          >
            <div className="grid grid-cols-10 gap-4 p-4 h-full">
              {loremColumns.current.map((text, index) => (
                <div key={index} className="text-black text-[5vh] leading-tight">
                  {text}
                </div>
              ))}
            </div>
          </div>
        )}

        {showAlternatingColumns && (
          <div className="grid grid-cols-10 gap-4 p-4 h-full overflow-hidden">
            {loremColumns.current.map((text, index) => (
              <div 
                key={index} 
                className="text-[5vh] leading-tight p-4 rounded-lg translate-y-[-150%]"
                style={{
                  backgroundColor: index % 3 === 0 ? '#EE2D29' : 'white',
                  color: index % 3 === 0 ? 'white' : 'black',
                  animation: !columnsRolling ? `slideDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards ${index * 120}ms` : 'none',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid rgba(0, 0, 0, 0.1)'
                }}
              >
                {text}
              </div>
            ))}
          </div>
        )}

        {displayText && (
          <div 
            className="absolute inset-0 flex items-center p-8 transition-transform duration-400 ease-in-out"
            style={{
              transform: slideDirection === 'horizontal'
                ? `translateX(${slidePosition === 'left' ? '-100%' : '0'})`
                : slideDirection === 'vertical'
                ? `translateY(${slidePosition === 'left' ? '100%' : '0'})`
                : 'none',
              color: backgroundColor === 'white' ? 'black' : 'white'
            }}
          >
            <h1 
              className="font-['National_2_Condensed'] font-bold leading-none"
              style={{ fontSize: '75vh' }}
            >
              {displayText}
            </h1>
          </div>
        )}
      </div>

      <style>
        {`
          @keyframes slideDown {
            0% {
              transform: translateY(-150%);
            }
            100% {
              transform: translateY(0);
            }
          }
        `}
      </style>
    </div>
  );
}

export default App;