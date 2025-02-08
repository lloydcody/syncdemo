import React, { useEffect, useState, useRef } from 'react';
import { TimingObject } from 'timing-object';
import Peer from 'peerjs';
import { Clock } from 'lucide-react';

const PEERJS_CONFIG = {
  host: "peerjs-server-t8z8.onrender.com",
  path: "/ddmbsync",
  key: "realtime",
  debug: 1,
  port: 443,
  secure: true,
};

const CYCLE_DURATION = 27; // seconds

function App() {
  const [clockTime, setClockTime] = useState<number>(0);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [peerCount, setPeerCount] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const [nextEvent, setNextEvent] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(0);
  const [backgroundColor, setBackgroundColor] = useState<string>('white');
  const [textColor, setTextColor] = useState<string>('black');
  const [displayText, setDisplayText] = useState<string>('CHICKEN');
  
  const timingObject = useRef<TimingObject>();
  const peer = useRef<Peer>();
  const connections = useRef<Set<Peer.DataConnection>>(new Set());
  const animationFrameRef = useRef<number>();
  
  // Get leftoffset and totalwidth from URL hash
  const leftOffset = window.location.hash ? 
    parseInt(window.location.hash.replace(/.*leftoffset=(\d+).*/, '$1'), 10) : 0;
  const totalWidth = window.location.hash ?
    parseInt(window.location.hash.replace(/.*totalwidth=(\d+).*/, '$1'), 10) : window.innerWidth;

  useEffect(() => {
    // Initialize timing object
    timingObject.current = new TimingObject({
      timestamp: Date.now() / 1000,
      position: 0,
      velocity: 1,
      acceleration: 0
    });
    
    // Initialize PeerJS for connection management
    const peerId = `MENUSYNC_${Math.random().toString(36).substr(2, 9)}`;
    peer.current = new Peer(peerId, PEERJS_CONFIG);
    
    peer.current.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      peer.current?.listAllPeers((peerList) => {
        const otherPeers = peerList.filter(pid => pid.startsWith('MENUSYNC_') && pid !== peerId);
        
        if (otherPeers.length > 0) {
          // If there are other peers, connect to the first one and sync timing
          const conn = peer.current?.connect(otherPeers[0]);
          if (conn) {
            conn.on('open', () => {
              conn.send({ type: 'sync-request' });
            });
            setupConnection(conn);
          }
        }
        
        // Connect to all other peers for redundancy
        otherPeers.slice(1).forEach(peerId => {
          const conn = peer.current?.connect(peerId);
          if (conn) setupConnection(conn);
        });
      });
    });

    peer.current.on('connection', (conn) => {
      setupConnection(conn);
    });

    // Animation update function using requestAnimationFrame
    const updateAnimation = () => {
      if (!timingObject.current) return;

      const query = timingObject.current.query();
      const position = query.position || 0;
      const adjustedPosition = position % CYCLE_DURATION;
      
      setClockTime(Date.now());
      setClockOffset(position * 1000); // Convert to milliseconds for display
      
      // Update animations based on timeline
      if (adjustedPosition < 12) {
        setBackgroundColor('white');
        setTextColor('black');
        setDisplayText('CHICKEN');
        setNextEvent('BURGERS');
        setCountdown(12 - adjustedPosition);
      } else if (adjustedPosition < 15) {
        setBackgroundColor('darkred');
        setTextColor('white');
        setDisplayText('BURGERS');
        setNextEvent('BLACK');
        setCountdown(15 - adjustedPosition);
      } else {
        setBackgroundColor('black');
        setTextColor('white');
        setDisplayText(
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\n' +
          'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\n' +
          'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.'
        );
        setNextEvent('CHICKEN');
        setCountdown(CYCLE_DURATION - adjustedPosition);
      }

      // Schedule next update
      animationFrameRef.current = requestAnimationFrame(updateAnimation);
    };

    // Start animation loop
    updateAnimation();

    // Cleanup function
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timingObject.current) {
        timingObject.current.update({ velocity: 0 });
      }
      peer.current?.destroy();
    };
  }, []);

  const setupConnection = (conn: Peer.DataConnection) => {
    conn.on('open', () => {
      connections.current.add(conn);
      setPeerCount(connections.current.size);
      
      // Measure latency
      const start = Date.now();
      conn.send({ type: 'ping', time: start });
    });

    conn.on('data', (data: any) => {
      if (data.type === 'ping') {
        conn.send({ type: 'pong', time: data.time });
      } else if (data.type === 'pong') {
        setLatency(Date.now() - data.time);
      } else if (data.type === 'sync-request') {
        // Send current timing state
        if (timingObject.current) {
          const state = timingObject.current.query();
          conn.send({ type: 'sync-response', state });
        }
      } else if (data.type === 'sync-response') {
        // Update timing object with received state
        if (timingObject.current) {
          timingObject.current.update(data.state);
        }
      }
    });

    conn.on('close', () => {
      connections.current.delete(conn);
      setPeerCount(connections.current.size);
    });
  };

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
      {/* Status Panel */}
      <div className="absolute top-4 left-4 bg-black/50 text-white p-4 rounded-lg">
        <div className="flex items-center gap-2">
          <Clock size={16} />
          <span>{new Date(clockTime).toISOString().substr(11, 8)}</span>
        </div>
        <div>Offset: {clockOffset.toFixed(2)}ms</div>
        <div>Peers: {peerCount}</div>
        <div>Latency: {latency}ms</div>
        <div>Next: {nextEvent} in {countdown.toFixed(1)}s</div>
        <div className="w-full bg-gray-200 h-2 mt-2 rounded">
          <div 
            className="bg-blue-600 h-2 rounded"
            style={{ width: `${(countdown / 12) * 100}%` }}
          />
        </div>
      </div>

      {/* Main Text Display */}
      <div 
        className="h-full flex items-center p-8"
        style={{ color: textColor }}
      >
        <h1 
          className="font-bold leading-none whitespace-pre-line"
          style={{ 
            fontSize: displayText.length > 100 ? '5vh' : '75vh',
            maxWidth: displayText.length > 100 ? '80ch' : 'none',
            columns: displayText.length > 100 ? '3' : 'auto'
          }}
        >
          {displayText}
        </h1>
      </div>
    </div>
  );
}

export default App;