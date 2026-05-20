/**
 * Eureka Insights: Nuclear Reactor Simulator
 * Core Physics and Animation Engine
 */

// Canvas Setup
const canvas = document.getElementById('reactor-canvas');
const ctx = canvas.getContext('2d');

// Simulation Dimensions (Logical Resolution)
const simWidth = 800;
const simHeight = 600;
canvas.width = simWidth;
canvas.height = simHeight;

// Audio Variables
let audioCtx = null;
let audioEnabled = true;
let lastClickTime = 0;
let lastAbsorbTime = 0;
let lastSirenTime = 0;

// Simulation State
let neutrons = [];
let particles = [];
let fuelRods = [];
let controlRods = [];
const maxNeutrons = 400;

// Reactor States
let rodInsertion = 0; // percentage: 0 to 100
let temperature = 20.0; // °C
const ambientTemp = 20.0;
const maxTemp = 1000.0;
let lastNeutronCount = 10;
let reactivityState = 'CRITICAL';
let coreStatus = 'NORMAL';
let isScrammed = false;

// Audio Toggle Listener
const audioToggle = document.getElementById('audio-toggle');
if (audioToggle) {
    audioEnabled = audioToggle.checked;
    audioToggle.addEventListener('change', (e) => {
        audioEnabled = e.target.checked;
        if (audioEnabled && !audioCtx) {
            initAudio();
        }
    });
}

// Lazy Initialize Web Audio API
function initAudio() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        addLog('[AUDIO] Synthesizer initialized successfully.', 'system');
    } catch (e) {
        console.warn('Web Audio API not supported in this browser');
        addLog('[AUDIO] Synthesis unsupported by this browser.', 'system');
    }
}

// Play a high-pitched click representing a fission event (Geiger counter click)
function playFissionSound() {
    if (!audioEnabled || !audioCtx) return;
    
    const now = audioCtx.currentTime;
    // Debounce to prevent audio overload
    if (now - lastClickTime < 0.015) return;
    lastClickTime = now;

    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sine';
        // Geiger clicks are high-frequency sine waves that decay rapidly
        osc.frequency.setValueAtTime(1400 + Math.random() * 600, now);
        
        // Rapid exponential gain decay
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        
        osc.start(now);
        osc.stop(now + 0.03);
    } catch (e) {
        // Ignore audio errors during rapid stop/start
    }
}

// Play a low-pitch fizz when a neutron is absorbed by a control rod
function playAbsorptionSound() {
    if (!audioEnabled || !audioCtx) return;
    
    const now = audioCtx.currentTime;
    if (now - lastAbsorbTime < 0.04) return;
    lastAbsorbTime = now;

    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.06);
        
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        
        osc.start(now);
        osc.stop(now + 0.08);
    } catch (e) {
        // Ignore errors
    }
}

// Play warning siren during meltdown state
function playSirenSound() {
    if (!audioEnabled || !audioCtx) return;
    
    const now = audioCtx.currentTime;
    if (now - lastSirenTime < 0.8) return;
    lastSirenTime = now;

    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sawtooth';
        // Wobble frequency between 400Hz and 600Hz
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.35);
        osc.frequency.linearRampToValueAtTime(400, now + 0.7);
        
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.04, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.04, now + 0.6);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.7);
        
        osc.start(now);
        osc.stop(now + 0.75);
    } catch (e) {
        // Ignore errors
    }
}

// Helper to push text to the console display
function addLog(text, type = 'normal') {
    const consoleBox = document.getElementById('console-logs');
    if (!consoleBox) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span style="opacity: 0.5;">[${timestamp}]</span> ${text}`;
    
    consoleBox.appendChild(entry);
    consoleBox.scrollTop = consoleBox.scrollHeight;
    
    // Cap console history at 30 logs to avoid bloating DOM
    while (consoleBox.children.length > 30) {
        consoleBox.removeChild(consoleBox.firstChild);
    }
}

// Visual Particle Emitters
function spawnSparks(x, y, color = '#4ade80') {
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 2;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 2 + Math.random() * 2,
            alpha: 1.0,
            decay: 0.03 + Math.random() * 0.02,
            color: color
        });
    }
}

function spawnAbsorptionRing(x, y) {
    const count = 6;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * 0.8,
            vy: Math.sin(angle) * 0.8,
            size: 1.5,
            alpha: 1.0,
            decay: 0.04,
            color: '#ef4444'
        });
    }
}

// Initialization of elements
function init() {
    neutrons = [];
    particles = [];
    fuelRods = [];
    controlRods = [];
    isScrammed = false;
    temperature = 20.0;
    
    const rodSlider = document.getElementById('rod-slider');
    if (rodSlider) {
        rodSlider.value = 0;
        rodInsertion = 0;
        document.getElementById('rod-val').textContent = '0%';
    }

    // Set up 3 static Fuel Rods
    // Spaced horizontally on 800px canvas: x = 200, 400, 600
    const fuelWidth = 45;
    const fuelHeight = 440;
    const fuelY = 80;
    
    fuelRods = [
        { x: 200, y: fuelY, width: fuelWidth, height: fuelHeight, left: 200 - fuelWidth/2, right: 200 + fuelWidth/2, top: fuelY, bottom: fuelY + fuelHeight, pulse: 0 },
        { x: 400, y: fuelY, width: fuelWidth, height: fuelHeight, left: 400 - fuelWidth/2, right: 400 + fuelWidth/2, top: fuelY, bottom: fuelY + fuelHeight, pulse: 0 },
        { x: 600, y: fuelY, width: fuelWidth, height: fuelHeight, left: 600 - fuelWidth/2, right: 600 + fuelWidth/2, top: fuelY, bottom: fuelY + fuelHeight, pulse: 0 }
    ];

    // Set up 4 dynamic Control Rods entering from top
    // Spaced at x = 100, 300, 500, 700
    const ctrlWidth = 30;
    const ctrlMaxDepth = 520; // extends down past the fuel rods
    
    controlRods = [
        { x: 100, width: ctrlWidth, maxDepth: ctrlMaxDepth },
        { x: 300, width: ctrlWidth, maxDepth: ctrlMaxDepth },
        { x: 500, width: ctrlWidth, maxDepth: ctrlMaxDepth },
        { x: 700, width: ctrlWidth, maxDepth: ctrlMaxDepth }
    ];

    // Spawn 10 active neutrons in random locations (excluding fuel rod bounds)
    const baseSpeed = 4.0;
    for (let i = 0; i < 10; i++) {
        spawnNeutron(baseSpeed);
    }

    addLog('[SYSTEM] Nuclear Core initialized. Baseline fuel rods operational.', 'normal');
    addLog('[SYSTEM] Control rods set to 0% insertion.', 'normal');
}

// Spawn single neutron at a random location outside fuel rods
function spawnNeutron(speed = 4.0, customX = null, customY = null) {
    let x, y;
    
    if (customX !== null && customY !== null) {
        x = customX;
        y = customY;
    } else {
        // Find a random spot away from rods to start clean
        let valid = false;
        while (!valid) {
            x = 50 + Math.random() * (simWidth - 100);
            y = 50 + Math.random() * (simHeight - 100);
            valid = true;
            
            // Check if inside a fuel rod
            for (let rod of fuelRods) {
                if (x > rod.left - 15 && x < rod.right + 15 && y > rod.top - 15 && y < rod.bottom + 15) {
                    valid = false;
                    break;
                }
            }
        }
    }

    const angle = Math.random() * Math.PI * 2;
    neutrons.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 6,
        cooldown: 0
    });
}

// Physics Logic Loop
function update() {
    // 1. Update rod insertion value from DOM slider (unless SCRAM overrides)
    if (!isScrammed) {
        const slider = document.getElementById('rod-slider');
        if (slider) {
            rodInsertion = parseInt(slider.value);
            document.getElementById('rod-val').textContent = `${rodInsertion}%`;
        }
    } else {
        // If scrammed, control rods fall instantly to 100% insertion
        if (rodInsertion < 100) {
            rodInsertion = Math.min(100, rodInsertion + 8); // fall speed
            const slider = document.getElementById('rod-slider');
            if (slider) slider.value = Math.floor(rodInsertion);
            document.getElementById('rod-val').textContent = `${Math.floor(rodInsertion)}%`;
        }
    }

    // Decay fuel rod flash pulses
    for (let rod of fuelRods) {
        if (rod.pulse > 0) rod.pulse -= 0.05;
        if (rod.pulse < 0) rod.pulse = 0;
    }

    // 2. Update and check Neutrons physics
    const speed = 4.0;
    const currentControlRodDepth = (rodInsertion / 100) * 520;

    for (let i = neutrons.length - 1; i >= 0; i--) {
        const n = neutrons[i];

        // Decay cooldown frames
        if (n.cooldown > 0) n.cooldown--;

        // Move
        n.x += n.vx;
        n.y += n.vy;

        // Bounce on Canvas boundaries
        if (n.x - n.radius < 0) {
            n.x = n.radius;
            n.vx = Math.abs(n.vx);
        } else if (n.x + n.radius > simWidth) {
            n.x = simWidth - n.radius;
            n.vx = -Math.abs(n.vx);
        }

        if (n.y - n.radius < 0) {
            n.y = n.radius;
            n.vy = Math.abs(n.vy);
        } else if (n.y + n.radius > simHeight) {
            n.y = simHeight - n.radius;
            n.vy = -Math.abs(n.vy);
        }

        // --- CONTROL ROD ABSORPTION EVENT ---
        let isAbsorbed = false;
        for (let cr of controlRods) {
            const left = cr.x - cr.width / 2;
            const right = cr.x + cr.width / 2;
            const bottom = currentControlRodDepth;

            // Is the neutron overlapping this active control rod vertical box?
            if (n.x + n.radius > left && n.x - n.radius < right && n.y - n.radius < bottom && n.y + n.radius > 0) {
                isAbsorbed = true;
                spawnAbsorptionRing(n.x, n.y);
                playAbsorptionSound();
                break;
            }
        }

        if (isAbsorbed) {
            neutrons.splice(i, 1);
            continue;
        }

        // --- FUEL ROD FISSION EVENT ---
        for (let j = 0; j < fuelRods.length; j++) {
            const rod = fuelRods[j];
            
            // Check bounding box overlap
            if (n.x + n.radius > rod.left && n.x - n.radius < rod.right &&
                n.y + n.radius > rod.top && n.y - n.radius < rod.bottom) {
                
                // Only trigger fission if neutron's collision cooldown is fully refreshed
                if (n.cooldown === 0) {
                    rod.pulse = 1.0; // Flash the rod
                    playFissionSound();
                    
                    // Bounce math: Determine which side was hit
                    const distLeft = n.x - rod.left;
                    const distRight = rod.right - n.x;
                    const distTop = n.y - rod.top;
                    const distBottom = rod.bottom - n.y;
                    
                    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
                    
                    if (minDist === distLeft) {
                        n.vx = -Math.abs(n.vx);
                        n.x = rod.left - n.radius;
                    } else if (minDist === distRight) {
                        n.vx = Math.abs(n.vx);
                        n.x = rod.right + n.radius;
                    } else if (minDist === distTop) {
                        n.vy = -Math.abs(n.vy);
                        n.y = rod.top - n.radius;
                    } else {
                        n.vy = Math.abs(n.vy);
                        n.y = rod.bottom + n.radius;
                    }
                    
                    n.cooldown = 12; // 12 frames of cooldown
                    spawnSparks(n.x, n.y, '#10b981');

                    // Fission: Spawn 1 new neutron if population limits permit
                    if (neutrons.length < maxNeutrons) {
                        // Spawn child heading outward
                        const childAngle = Math.random() * Math.PI * 2;
                        neutrons.push({
                            x: n.x,
                            y: n.y,
                            vx: Math.cos(childAngle) * speed,
                            vy: Math.sin(childAngle) * speed,
                            radius: 6,
                            cooldown: 12
                        });
                    }
                    break;
                }
            }
        }
    }

    // 3. Update Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
            particles.splice(i, 1);
        }
    }

    // 4. Heat & Temperature Dynamics
    // Heating increases slightly per active neutron, cooling drops it back to ambient
    const heatingRate = 0.05; // Degrees per frame per neutron
    const coolingFactor = 0.0055; // Newton cooling coefficient
    
    const heatAdded = neutrons.length * heatingRate;
    const heatLost = (temperature - ambientTemp) * coolingFactor;
    
    temperature += heatAdded - heatLost;
    temperature = Math.max(ambientTemp, Math.min(maxTemp, temperature));

    // 5. Update Status State & Alert Classes
    const tempPercent = (temperature - ambientTemp) / (maxTemp - ambientTemp);
    const canvasContainer = document.getElementById('canvas-container');
    const statusLed = document.getElementById('status-led');
    const statusLabel = document.getElementById('status-label');
    const meltdownOverlay = document.getElementById('meltdown-overlay');

    // UI Reactivity State description
    const reactDisplay = document.getElementById('reactivity-state');
    if (neutrons.length === 0) {
        reactivityState = 'SHUTDOWN';
        if (reactDisplay) {
            reactDisplay.textContent = 'SHUTDOWN';
            reactDisplay.className = 'digital-number';
            reactDisplay.style.color = '#64748b';
            reactDisplay.style.textShadow = 'none';
        }
    } else if (rodInsertion > 50) {
        reactivityState = 'SUBCRITICAL';
        if (reactDisplay) {
            reactDisplay.textContent = 'SUBCRITICAL';
            reactDisplay.className = 'digital-number';
            reactDisplay.style.color = '#38bdf8';
            reactDisplay.style.textShadow = '0 0 8px rgba(56, 189, 248, 0.4)';
        }
    } else if (rodInsertion < 35) {
        reactivityState = 'SUPERCRITICAL';
        if (reactDisplay) {
            reactDisplay.textContent = 'SUPERCRITICAL';
            reactDisplay.className = 'digital-number';
            reactDisplay.style.color = '#ef4444';
            reactDisplay.style.textShadow = '0 0 8px rgba(239, 68, 68, 0.4)';
        }
    } else {
        reactivityState = 'CRITICAL';
        if (reactDisplay) {
            reactDisplay.textContent = 'CRITICAL';
            reactDisplay.className = 'digital-number';
            reactDisplay.style.color = '#10b981';
            reactDisplay.style.textShadow = '0 0 8px rgba(16, 185, 129, 0.4)';
        }
    }

    if (tempPercent < 0.5) {
        // NORMAL State
        if (coreStatus !== 'NORMAL') {
            coreStatus = 'NORMAL';
            addLog('[STATUS] Reactor core thermal levels stable.', 'normal');
            statusLed.className = 'led';
            statusLabel.className = 'status-label';
            statusLabel.textContent = 'STATUS: NORMAL';
            canvasContainer.classList.remove('shake');
            meltdownOverlay.classList.add('hidden');
        }
    } else if (tempPercent >= 0.5 && tempPercent <= 0.85) {
        // WARNING State
        if (coreStatus !== 'WARNING') {
            coreStatus = 'WARNING';
            addLog('[WARNING] Thermal limits exceeded. Thermal rise active!', 'warning');
            statusLed.className = 'led warning';
            statusLabel.className = 'status-label warning';
            statusLabel.textContent = 'STATUS: WARNING - HIGH TEMP';
            canvasContainer.classList.remove('shake');
            meltdownOverlay.classList.add('hidden');
        }
    } else {
        // MELTDOWN IMMINENT State
        if (coreStatus !== 'MELTDOWN') {
            coreStatus = 'MELTDOWN';
            addLog('[CRITICAL] Core thermal runaway. Meltdown imminent!', 'danger');
            statusLed.className = 'led danger';
            statusLabel.className = 'status-label danger';
            statusLabel.textContent = 'STATUS: MELTDOWN IMMINENT';
            canvasContainer.classList.add('shake');
            meltdownOverlay.classList.remove('hidden');
        }
        playSirenSound();
    }

    // 6. Update HTML Panel Displays
    const tempDisplay = document.getElementById('temp-display');
    if (tempDisplay) {
        tempDisplay.textContent = `${temperature.toFixed(1)} °C`;
    }

    const tempBar = document.getElementById('temp-bar');
    if (tempBar) {
        const pct = tempPercent * 100;
        tempBar.style.width = `${pct}%`;
        
        // Add neon shadow overlay in critical temperatures
        if (tempPercent > 0.85) {
            tempBar.classList.add('danger');
        } else {
            tempBar.classList.remove('danger');
        }
    }

    const neutronCount = document.getElementById('neutron-count');
    if (neutronCount) {
        neutronCount.textContent = neutrons.length;
    }
}

// Drawing Logic Loop
function draw() {
    // 1. Semi-transparent background clear for beautiful speed trails
    ctx.fillStyle = 'rgba(3, 7, 18, 0.28)';
    ctx.fillRect(0, 0, simWidth, simHeight);

    // 2. Draw high-tech grid overlay in background
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.025)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    
    for (let x = 0; x < simWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, simHeight);
        ctx.stroke();
    }
    for (let y = 0; y < simHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(simWidth, y);
        ctx.stroke();
    }

    // 3. Draw Static Fuel Rods with glows
    for (let rod of fuelRods) {
        // Base structure
        ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
        ctx.fillRect(rod.left, rod.top, rod.width, rod.height);

        // Neon Green border outline
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rod.left, rod.top, rod.width, rod.height);

        // Fission collision highlight pulses
        if (rod.pulse > 0) {
            ctx.fillStyle = `rgba(74, 222, 128, ${rod.pulse * 0.35})`;
            ctx.fillRect(rod.left, rod.top, rod.width, rod.height);
            
            ctx.strokeStyle = `rgba(255, 255, 255, ${rod.pulse * 0.8})`;
            ctx.lineWidth = 3;
            ctx.strokeRect(rod.left, rod.top, rod.width, rod.height);
        }
    }

    // 4. Draw Active Neutrons (sky blue glowing circles)
    for (let n of neutrons) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        
        // Solid core
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Neon outer glow ring
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // 5. Draw Dynamic Control Rods dropping from top ceiling (rendered on top of neutrons)
    const currentControlRodDepth = (rodInsertion / 100) * 520;

    for (let cr of controlRods) {
        const left = cr.x - cr.width / 2;
        
        // Rod body (metallic slate grey with nice gradient sheen)
        const gradient = ctx.createLinearGradient(left, 0, left + cr.width, 0);
        gradient.addColorStop(0, '#334155');
        gradient.addColorStop(0.3, '#64748b');
        gradient.addColorStop(0.7, '#475569');
        gradient.addColorStop(1, '#1e293b');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(left, 0, cr.width, currentControlRodDepth);

        // Control Rod side warning neon lines (glowing red indicators)
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left + 3, 0);
        ctx.lineTo(left + 3, currentControlRodDepth - 5);
        ctx.moveTo(left + cr.width - 3, 0);
        ctx.lineTo(left + cr.width - 3, currentControlRodDepth - 5);
        ctx.stroke();

        // Lower Absorber Tip (heavy ceramic visual block)
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(left, Math.max(0, currentControlRodDepth - 10), cr.width, 10);
        
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(left + 4, Math.max(0, currentControlRodDepth - 5), cr.width - 8, 5);
    }

    // 6. Draw Sparks and Explosion Particles
    for (let p of particles) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Main Frame loop
function simLoop() {
    update();
    draw();
    requestAnimationFrame(simLoop);
}

// Controller Interaction Listeners
function setupControls() {
    const injectBtn = document.getElementById('inject-btn');
    if (injectBtn) {
        injectBtn.addEventListener('click', () => {
            initAudio(); // Initialize audio context on click if not done yet
            if (neutrons.length < maxNeutrons) {
                spawnNeutron(4.0);
                addLog('[INJECT] Manually inserted thermal neutron into core.', 'system');
            } else {
                addLog('[INJECT] Failed: Core neutron concentration at maximum limit.', 'warning');
            }
        });
    }

    const scramBtn = document.getElementById('scram-btn');
    if (scramBtn) {
        scramBtn.addEventListener('click', () => {
            initAudio(); // Initialize audio context on click
            isScrammed = true;
            addLog('[SCRAM] EMERGENCY SYSTEM ACTIVED. DRIVING SAFETY ABSORBERS!', 'danger');
            
            const scramButton = document.getElementById('scram-btn');
            scramButton.classList.add('danger-flash');
            
            // Temporary sound effect trigger
            if (audioEnabled && audioCtx) {
                try {
                    const now = audioCtx.currentTime;
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(350, now);
                    osc.frequency.linearRampToValueAtTime(100, now + 0.6);
                    
                    gain.gain.setValueAtTime(0.08, now);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
                    
                    osc.start(now);
                    osc.stop(now + 0.6);
                } catch(e) {}
            }
        });
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            initAudio(); // Initialize audio context on click
            init();
            const scramButton = document.getElementById('scram-btn');
            if (scramButton) scramButton.classList.remove('danger-flash');
            addLog('[RESET] Simulation environment reset. Status NORMAL.', 'system');
        });
    }

    // Touch support / Slider sound startup
    const slider = document.getElementById('rod-slider');
    if (slider) {
        slider.addEventListener('mousedown', () => initAudio());
        slider.addEventListener('touchstart', () => initAudio());
    }
}

// Start simulation on load
window.addEventListener('DOMContentLoaded', () => {
    init();
    setupControls();
    requestAnimationFrame(simLoop);
});
