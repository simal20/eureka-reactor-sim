/**
 * Eureka Insights: Nuclear Power Plant Simulator
 * Process Flow Diagram (PFD) and Plant Dynamics Engine
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
let turbineOsc = null;
let turbineGain = null;

// Particle Arrays
let neutrons = [];
let particles = []; // sparks, steam, vapor
let steamParticles = [];
let coolingParticles = [];

// Static Component Coordinates & Bounding Boxes (for PFD layout)
const coreBounds = { x: 50, y: 150, width: 160, height: 330 };
const fuelWidth = 14;
const fuelHeight = 240;
const fuelY = 200;
const fuelRods = [
    { x: 90,  y: fuelY, width: fuelWidth, height: fuelHeight, left: 90 - fuelWidth/2,  right: 90 + fuelWidth/2,  top: fuelY, bottom: fuelY + fuelHeight, pulse: 0 },
    { x: 130, y: fuelY, width: fuelWidth, height: fuelHeight, left: 130 - fuelWidth/2, right: 130 + fuelWidth/2, top: fuelY, bottom: fuelY + fuelHeight, pulse: 0 },
    { x: 170, y: fuelY, width: fuelWidth, height: fuelHeight, left: 170 - fuelWidth/2, right: 170 + fuelWidth/2, top: fuelY, bottom: fuelY + fuelHeight, pulse: 0 }
];

const ctrlWidth = 8;
const ctrlMaxDepth = 260;
const controlRods = [
    { x: 70,  width: ctrlWidth, maxDepth: ctrlMaxDepth },
    { x: 110, width: ctrlWidth, maxDepth: ctrlMaxDepth },
    { x: 150, width: ctrlWidth, maxDepth: ctrlMaxDepth },
    { x: 190, width: ctrlWidth, maxDepth: ctrlMaxDepth }
];

// Pipe Coordinates (PFD connections)
const primarySteamPath = [
    { x: 130, y: 150 }, // Core top
    { x: 130, y: 90 },  // Core header
    { x: 450, y: 90 },  // To Turbine
    { x: 450, y: 165 }, // Turbine inlet
];
const postTurbinePath = [
    { x: 450, y: 220 }, // Turbine outlet
    { x: 450, y: 375 }  // Condenser inlet
];
const feedWaterPath = [
    { x: 450, y: 445 }, // Condenser outlet
    { x: 450, y: 465 }, // Loop bottom
    { x: 290, y: 465 }, // To Feedwater Pump
    { x: 290, y: 435 }  // Pump inlet (implied pump at 290, 420)
];
const pumpToCorePath = [
    { x: 290, y: 405 }, // Pump outlet
    { x: 290, y: 380 }, // Lift
    { x: 130, y: 380 }, // Return header
    { x: 130, y: 450 }  // Core return
];
const hotCoolingPath = [
    { x: 500, y: 415 }, // Condenser cooling outlet
    { x: 600, y: 415 }, // Route right
    { x: 600, y: 340 }, // Route up
    { x: 690, y: 340 }  // Cooling Tower spray header
];
const coldCoolingPath = [
    { x: 710, y: 475 }, // Basin outlet
    { x: 600, y: 475 }, // Route left
    { x: 600, y: 440 }, // Route up
    { x: 500, y: 440 }  // Condenser cooling inlet
];

// Machinery Rotation Angles
let turbineAngle = 0;
let pumpAngle = 0;

// Simulation Inputs & Sliders
let rodInsertion = 0;       // %
let feedwaterSpeed = 50;     // %
let coolingTowerFan = 50;    // %
let generatorSynced = false; // ON/OFF

// Simulation Metrics
const ambientTemp = 20.0;  // °C
const maxTemp = 1000.0;    // °C
let temperature = ambientTemp; // °C
let steamPressure = 0.0;   // Bar
let turbineRPM = 0.0;      // RPM
let mwOutput = 0.0;        // Megawatts
let maxNeutrons = 400;
let reactivityState = 'CRITICAL';
let coreStatus = 'NORMAL';
let isScrammed = false;

// Audio Settings Listener
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
        
        // Setup continuous turbine hum oscillator
        turbineOsc = audioCtx.createOscillator();
        turbineGain = audioCtx.createGain();
        
        turbineOsc.type = 'triangle'; // Smooth hum tone
        turbineOsc.frequency.setValueAtTime(0, audioCtx.currentTime);
        turbineGain.gain.setValueAtTime(0, audioCtx.currentTime);
        
        turbineOsc.connect(turbineGain);
        turbineGain.connect(audioCtx.destination);
        
        turbineOsc.start();
        
        addLog('[AUDIO] Synthesizer initialized. Turbine hum loop active.', 'system');
    } catch (e) {
        console.warn('Web Audio API not supported in this browser');
        addLog('[AUDIO] Synthesis unsupported by this browser.', 'system');
    }
}

// Play a high-pitched click representing a fission event (Geiger counter click)
function playFissionSound() {
    if (!audioEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;
    if (now - lastClickTime < 0.015) return;
    lastClickTime = now;

    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400 + Math.random() * 600, now);
        
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        
        osc.start(now);
        osc.stop(now + 0.03);
    } catch (e) {}
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
    } catch (e) {}
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
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.linearRampToValueAtTime(600, now + 0.35);
        osc.frequency.linearRampToValueAtTime(400, now + 0.7);
        
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.04, now + 0.1);
        gain.gain.linearRampToValueAtTime(0.04, now + 0.6);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.7);
        
        osc.start(now);
        osc.stop(now + 0.75);
    } catch (e) {}
}

// Logger System
function addLog(text, type = 'normal') {
    const consoleBox = document.getElementById('console-logs');
    if (!consoleBox) return;
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span style="opacity: 0.5;">[${timestamp}]</span> ${text}`;
    
    consoleBox.appendChild(entry);
    consoleBox.scrollTop = consoleBox.scrollHeight;
    
    while (consoleBox.children.length > 25) {
        consoleBox.removeChild(consoleBox.firstChild);
    }
}

// Particle System Helpers
function spawnFissionSparks(x, y) {
    const count = 4;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 0.5 + Math.random() * 1.5;
        particles.push({
            type: 'spark',
            x: x, y: y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            size: 1.5 + Math.random() * 1.5,
            alpha: 1.0,
            decay: 0.04,
            color: '#10b981'
        });
    }
}

function spawnAbsorptionSparks(x, y) {
    const count = 5;
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 0.4 + Math.random() * 1.0;
        particles.push({
            type: 'spark',
            x: x, y: y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            size: 1.5,
            alpha: 1.0,
            decay: 0.05,
            color: '#ef4444'
        });
    }
}

function spawnVaporPlume() {
    // Emitters located at the top rim of the Cooling Tower: x in [675, 745], y = 280
    const x = 678 + Math.random() * 64;
    const y = 280;
    const riseSpeed = 0.5 + Math.random() * 0.8;
    const spreadSpeed = (Math.random() - 0.5) * 0.4;
    particles.push({
        type: 'vapor',
        x: x, y: y,
        vx: spreadSpeed,
        vy: -riseSpeed,
        size: 8 + Math.random() * 12,
        alpha: 0.35 + Math.random() * 0.25,
        decay: 0.004 + Math.random() * 0.003,
        color: '#e2e8f0'
    });
}

// Interpolate position along a coordinate path list
function getPathPoint(path, progress) {
    const idx = Math.floor(progress);
    const frac = progress - idx;
    if (idx >= path.length - 1) {
        return path[path.length - 1];
    }
    const p1 = path[idx];
    const p2 = path[idx + 1];
    return {
        x: p1.x + (p2.x - p1.x) * frac,
        y: p1.y + (p2.y - p1.y) * frac
    };
}

// Generate fluid particles for pipelines
function initFlowParticles() {
    steamParticles = [];
    coolingParticles = [];
    
    // Spaced out particles in the Steam/Feedwater Loops
    const totalSteamParticles = 30;
    for (let i = 0; i < totalSteamParticles; i++) {
        steamParticles.push({
            loop: 'steam', // travels across steam loops
            progress: (i / totalSteamParticles) * 3.99 // scales from 0 to 4 path nodes
        });
    }
    
    const totalFeedParticles = 20;
    for (let i = 0; i < totalFeedParticles; i++) {
        steamParticles.push({
            loop: 'feedwater',
            progress: (i / totalFeedParticles) * 3.99
        });
    }

    // Cooling water particles (secondary loop)
    const totalCoolingParticles = 35;
    for (let i = 0; i < totalCoolingParticles; i++) {
        coolingParticles.push({
            loop: Math.random() > 0.5 ? 'hot' : 'cold',
            progress: Math.random() * 3.99
        });
    }
}

// Initialize environment
function init() {
    neutrons = [];
    particles = [];
    isScrammed = false;
    temperature = 20.0;
    steamPressure = 0.0;
    turbineRPM = 0.0;
    mwOutput = 0.0;
    generatorSynced = false;

    // Reset DOM Elements
    const rodSlider = document.getElementById('rod-slider');
    if (rodSlider) rodSlider.value = 0;
    rodInsertion = 0;
    document.getElementById('rod-val').textContent = '0%';

    const pumpSlider = document.getElementById('pump-slider');
    if (pumpSlider) pumpSlider.value = 50;
    feedwaterSpeed = 50;
    document.getElementById('pump-val').textContent = '50%';

    const fanSlider = document.getElementById('fan-slider');
    if (fanSlider) fanSlider.value = 50;
    coolingTowerFan = 50;
    document.getElementById('fan-val').textContent = '50%';

    const syncToggle = document.getElementById('sync-toggle');
    if (syncToggle) syncToggle.checked = false;
    document.getElementById('sync-val').textContent = 'OFF';
    document.getElementById('sync-val').style.color = '#64748b';
    document.getElementById('sync-led').className = 'sync-led';

    const scramBtn = document.getElementById('scram-btn');
    if (scramBtn) scramBtn.classList.remove('danger-flash');

    // Spawn 10 neutrons locked inside core coordinates: x in [50, 210], y in [150, 480]
    for (let i = 0; i < 10; i++) {
        spawnNeutronInCore();
    }

    initFlowParticles();
    
    addLog('[SYSTEM] Nuclear Core initialized. Flow Loops online.', 'normal');
    addLog('[SYSTEM] Ready for operations. Inject neutron to spark core fission.', 'normal');
}

// Spawn single neutron inside localized core box
function spawnNeutronInCore() {
    const rx = 60 + Math.random() * 140;
    const ry = 160 + Math.random() * 300;
    const angle = Math.random() * Math.PI * 2;
    const speed = 3.5;
    neutrons.push({
        x: rx,
        y: ry,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 4.5,
        cooldown: 0
    });
}

// Physics Loop
function update() {
    // --- 1. Read UI Inputs ---
    if (!isScrammed) {
        const rodSlider = document.getElementById('rod-slider');
        if (rodSlider) {
            rodInsertion = parseInt(rodSlider.value);
            document.getElementById('rod-val').textContent = `${rodInsertion}%`;
        }
    } else {
        // SCRAM forces control rods to slide in rapidly
        if (rodInsertion < 100) {
            rodInsertion = Math.min(100, rodInsertion + 8);
            const slider = document.getElementById('rod-slider');
            if (slider) slider.value = Math.floor(rodInsertion);
            document.getElementById('rod-val').textContent = `${Math.floor(rodInsertion)}%`;
        }
    }

    const pumpSlider = document.getElementById('pump-slider');
    if (pumpSlider) {
        feedwaterSpeed = parseInt(pumpSlider.value);
        document.getElementById('pump-val').textContent = `${feedwaterSpeed}%`;
    }

    const fanSlider = document.getElementById('fan-slider');
    if (fanSlider) {
        coolingTowerFan = parseInt(fanSlider.value);
        document.getElementById('fan-val').textContent = `${coolingTowerFan}%`;
    }

    const syncToggle = document.getElementById('sync-toggle');
    if (syncToggle) {
        generatorSynced = syncToggle.checked;
        const syncVal = document.getElementById('sync-val');
        const syncLed = document.getElementById('sync-led');
        
        if (generatorSynced) {
            syncVal.textContent = 'ON';
            // Grid frequency matching test: generator sync is valid around 3000 RPM (e.g. 2900 - 3100)
            if (turbineRPM >= 2850 && turbineRPM <= 3150) {
                syncVal.style.color = '#10b981';
                syncLed.className = 'sync-led active';
            } else {
                syncVal.style.color = '#f59e0b';
                syncLed.className = 'sync-led warning';
            }
        } else {
            syncVal.textContent = 'OFF';
            syncVal.style.color = '#64748b';
            syncLed.className = 'sync-led';
        }
    }

    // --- 2. Update Neutrons (within Core bounds: x [50, 210], y [150, 480]) ---
    const currentControlRodDepth = (rodInsertion / 100) * ctrlMaxDepth;
    const neutronSpeed = 3.5;
    
    // Bounds definitions
    const cLeft = coreBounds.x;
    const cRight = coreBounds.x + coreBounds.width;
    const cTop = coreBounds.y;
    const cBottom = coreBounds.y + coreBounds.height;

    for (let i = neutrons.length - 1; i >= 0; i--) {
        const n = neutrons[i];

        if (n.cooldown > 0) n.cooldown--;

        // Move
        n.x += n.vx;
        n.y += n.vy;

        // Bouncing on Reactor Core boundaries
        if (n.x - n.radius < cLeft) {
            n.x = cLeft + n.radius;
            n.vx = Math.abs(n.vx);
        } else if (n.x + n.radius > cRight) {
            n.x = cRight - n.radius;
            n.vx = -Math.abs(n.vx);
        }

        if (n.y - n.radius < cTop) {
            n.y = cTop + n.radius;
            n.vy = Math.abs(n.vy);
        } else if (n.y + n.radius > cBottom) {
            n.y = cBottom - n.radius;
            n.vy = -Math.abs(n.vy);
        }

        // --- ABSORPTION CHECK (Control Rods) ---
        let absorbed = false;
        for (let cr of controlRods) {
            const left = cr.x - cr.width / 2;
            const right = cr.x + cr.width / 2;
            // Control Rods descend from the top lid of core (y = 150)
            const bottom = cTop + currentControlRodDepth;

            if (n.x + n.radius > left && n.x - n.radius < right &&
                n.y - n.radius < bottom && n.y + n.radius > cTop) {
                absorbed = true;
                spawnAbsorptionSparks(n.x, n.y);
                playAbsorptionSound();
                break;
            }
        }

        if (absorbed) {
            neutrons.splice(i, 1);
            continue;
        }

        // --- FISSION CHECK (Fuel Rods) ---
        for (let j = 0; j < fuelRods.length; j++) {
            const rod = fuelRods[j];
            
            if (n.x + n.radius > rod.left && n.x - n.radius < rod.right &&
                n.y + n.radius > rod.top && n.y - n.radius < rod.bottom) {
                
                if (n.cooldown === 0) {
                    rod.pulse = 1.0;
                    playFissionSound();
                    
                    // Elastic collision reflection
                    const distL = n.x - rod.left;
                    const distR = rod.right - n.x;
                    const distT = n.y - rod.top;
                    const distB = rod.bottom - n.y;
                    const min = Math.min(distL, distR, distT, distB);
                    
                    if (min === distL) {
                        n.vx = -Math.abs(n.vx);
                        n.x = rod.left - n.radius;
                    } else if (min === distR) {
                        n.vx = Math.abs(n.vx);
                        n.x = rod.right + n.radius;
                    } else if (min === distT) {
                        n.vy = -Math.abs(n.vy);
                        n.y = rod.top - n.radius;
                    } else {
                        n.vy = Math.abs(n.vy);
                        n.y = rod.bottom + n.radius;
                    }
                    
                    n.cooldown = 12;
                    spawnFissionSparks(n.x, n.y);

                    if (neutrons.length < maxNeutrons) {
                        const childAngle = Math.random() * Math.PI * 2;
                        neutrons.push({
                            x: n.x,
                            y: n.y,
                            vx: Math.cos(childAngle) * neutronSpeed,
                            vy: Math.sin(childAngle) * neutronSpeed,
                            radius: 4.5,
                            cooldown: 12
                        });
                    }
                    break;
                }
            }
        }
    }

    // Decay fuel rod flash pulses
    for (let rod of fuelRods) {
        if (rod.pulse > 0) rod.pulse -= 0.05;
    }

    // --- 3. Plant Coupled Physics Loop ---
    // (a) Temperature Dynamics
    // Fission adds thermal energy. Pump flow removes thermal energy.
    const heatRate = 0.065; // per frame per neutron
    const heatAdded = neutrons.length * heatRate;
    
    // Coolant cooling tower multiplier (high fan speed = colder loop)
    const towerCoolingMultiplier = (coolingTowerFan / 100) * 0.75 + 0.25;
    // Feedwater pump flow cooling
    const pumpCoolingRate = (feedwaterSpeed / 100) * 0.0075 * (temperature - ambientTemp) * towerCoolingMultiplier;
    
    // Natural convection ambient loss
    const ambientLoss = (temperature - ambientTemp) * 0.0004;

    temperature += heatAdded - pumpCoolingRate - ambientLoss;
    temperature = Math.max(ambientTemp, Math.min(maxTemp, temperature));

    // (b) Steam Pressure (in Bar)
    // Core heat boils coolant into high-pressure steam (starts > 100°C)
    let targetPressure = 0.0;
    if (temperature > 100.0) {
        targetPressure = (temperature - 100.0) * 0.17; // max is (1000 - 100) * 0.17 = 153 Bar
    }
    // Pressure dampening (volume expansion delay)
    steamPressure += (targetPressure - steamPressure) * 0.035;

    // (c) Turbine Speed (RPM)
    // Steam pressure drives turbine rotation.
    // If generator is synced to the grid, grid loads act as a damper, forcing turbine to synched RPM (3000).
    // If generator is desynced, turbine has no resistance (torque load), leading to over-speed runaway!
    let targetRPM = 0.0;
    if (generatorSynced) {
        if (steamPressure > 5.0) {
            // Lock onto grid sync frequency (3000 RPM)
            targetRPM = 3000;
        } else {
            // Drop out of sync
            targetRPM = steamPressure * 30;
        }
    } else {
        // Freewheeling (runaway) RPM
        targetRPM = steamPressure * 33.5; // Max 153 * 33.5 = 5125 RPM
    }
    
    turbineRPM += (targetRPM - turbineRPM) * 0.02;

    // (d) Electricity Output (MW)
    if (generatorSynced && turbineRPM > 2000) {
        // Output proportional to steam torque pressure and sync speed
        const loadCoefficient = (turbineRPM / 3000);
        const power = loadCoefficient * (steamPressure / 120.0) * 1100.0;
        mwOutput = Math.max(0, Math.min(1250, power));
    } else {
        mwOutput = 0.0;
    }

    // --- 4. System Logic & Safety Checks ---
    const tempPercent = (temperature - ambientTemp) / (maxTemp - ambientTemp);
    const canvasContainer = document.getElementById('canvas-container');
    const statusLed = document.getElementById('status-led');
    const statusLabel = document.getElementById('status-label');
    const meltdownOverlay = document.getElementById('meltdown-overlay');

    // Reactivity Level Text
    const reactDisplay = document.getElementById('reactivity-state');
    if (neutrons.length === 0) {
        reactivityState = 'SHUTDOWN';
        if (reactDisplay) {
            reactDisplay.textContent = 'SHUTDOWN';
            reactDisplay.style.color = '#64748b';
            reactDisplay.style.textShadow = 'none';
        }
    } else if (rodInsertion > 50) {
        reactivityState = 'SUBCRITICAL';
        if (reactDisplay) {
            reactDisplay.textContent = 'SUBCRITICAL';
            reactDisplay.style.color = '#38bdf8';
            reactDisplay.style.textShadow = '0 0 8px rgba(56, 189, 248, 0.4)';
        }
    } else if (rodInsertion < 35) {
        reactivityState = 'SUPERCRITICAL';
        if (reactDisplay) {
            reactDisplay.textContent = 'SUPERCRITICAL';
            reactDisplay.style.color = '#ef4444';
            reactDisplay.style.textShadow = '0 0 8px rgba(239, 68, 68, 0.4)';
        }
    } else {
        reactivityState = 'CRITICAL';
        if (reactDisplay) {
            reactDisplay.textContent = 'CRITICAL';
            reactDisplay.style.color = '#10b981';
            reactDisplay.style.textShadow = '0 0 8px rgba(16, 185, 129, 0.4)';
        }
    }

    // Alarm Warnings
    if (tempPercent < 0.5) {
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
        if (coreStatus !== 'WARNING') {
            coreStatus = 'WARNING';
            addLog('[WARNING] Core heat rising! Increase Feedwater speed or lower control rods.', 'warning');
            statusLed.className = 'led warning';
            statusLabel.className = 'status-label warning';
            statusLabel.textContent = 'STATUS: WARNING - HIGH TEMP';
            canvasContainer.classList.remove('shake');
            meltdownOverlay.classList.add('hidden');
        }
    } else {
        if (coreStatus !== 'MELTDOWN') {
            coreStatus = 'MELTDOWN';
            addLog('[CRITICAL] Core thermal runaway! Meltdown imminent. Trigger SCRAM!', 'danger');
            statusLed.className = 'led danger';
            statusLabel.className = 'status-label danger';
            statusLabel.textContent = 'STATUS: MELTDOWN IMMINENT';
            canvasContainer.classList.add('shake');
            meltdownOverlay.classList.remove('hidden');
        }
        playSirenSound();
    }

    // Grid Sync Status and Overspeed checks
    if (!generatorSynced && turbineRPM > 3300) {
        if (Math.floor(Date.now() / 1000) % 4 === 0) {
            addLog('[ALERT] Turbine overspeed warning: Generator desynced. Open Bypass Valve or insert rods!', 'warning');
        }
    }

    // Sync status log events
    const syncLed = document.getElementById('sync-led');
    if (generatorSynced && turbineRPM > 2000) {
        if (turbineRPM < 2850 || turbineRPM > 3150) {
            if (Math.floor(Date.now() / 1000) % 5 === 0) {
                addLog('[WARNING] Generator frequency drift. Sync unstable.', 'warning');
            }
        }
    }

    // --- 5. Update HTML Displays ---
    document.getElementById('temp-display').textContent = `${temperature.toFixed(1)} °C`;
    const tempBar = document.getElementById('temp-bar');
    if (tempBar) {
        tempBar.style.width = `${tempPercent * 100}%`;
        if (tempPercent > 0.85) tempBar.classList.add('danger');
        else tempBar.classList.remove('danger');
    }
    
    document.getElementById('neutron-count').textContent = neutrons.length;
    document.getElementById('pressure-display').textContent = `${steamPressure.toFixed(1)} Bar`;
    document.getElementById('rpm-display').textContent = `${Math.floor(turbineRPM)} RPM`;
    document.getElementById('mw-display').textContent = `${mwOutput.toFixed(1)} MW`;

    // --- 6. Update Particle Positions and Impeller Rotations ---
    turbineAngle += (turbineRPM / 60) * 0.1;
    pumpAngle += (feedwaterSpeed / 100) * 0.25;

    // Steam Flow speed
    // Speed proportional to steam pressure and feedwater pump speed
    const steamFlowRate = (steamPressure / 150) * 0.05 + (feedwaterSpeed / 100) * 0.02 + 0.005;
    for (let sp of steamParticles) {
        sp.progress += steamFlowRate;
        if (sp.progress >= 3.99) sp.progress = 0;
    }

    // Cooling Water Flow speed
    const coolingFlowRate = (coolingTowerFan / 100) * 0.04 + 0.005;
    for (let cp of coolingParticles) {
        cp.progress += coolingFlowRate;
        if (cp.progress >= 3.99) cp.progress = 0;
    }

    // Emitters (Particles: sparks, vapor)
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
            particles.splice(i, 1);
        }
    }

    // Emit vapor plume from cooling tower (scales with heat load and fan speed)
    const plumeThreshold = 0.95 - (coolingTowerFan / 100) * 0.08 - (temperature / 1000) * 0.05;
    if (Math.random() > Math.max(0.1, plumeThreshold)) {
        spawnVaporPlume();
    }

    // --- 7. Synthesize Turbine hum pitch/volume ---
    if (audioEnabled && audioCtx && turbineOsc && turbineGain) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const humGain = (turbineRPM / 4500) * 0.018; // soft hum
        turbineGain.gain.setTargetAtTime(humGain, audioCtx.currentTime, 0.1);
        
        const humFreq = 30 + (turbineRPM / 3000) * 110; // 30Hz to 140Hz
        turbineOsc.frequency.setTargetAtTime(humFreq, audioCtx.currentTime, 0.1);
    } else if (turbineGain) {
        turbineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    }
}

// Drawing PFD Elements
function draw() {
    // 1. CRT Screen trails clear
    ctx.fillStyle = 'rgba(3, 7, 18, 0.28)';
    ctx.fillRect(0, 0, simWidth, simHeight);

    // 2. Grid Overlay
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.015)';
    ctx.lineWidth = 1;
    const grid = 40;
    for (let x = 0; x < simWidth; x += grid) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, simHeight); ctx.stroke();
    }
    for (let y = 0; y < simHeight; y += grid) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(simWidth, y); ctx.stroke();
    }

    // 3. Draw Pipings (PFD Layout background rails)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawPipeline = (path) => {
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
    };

    // Draw primary steam lines and cooling water lines
    drawPipeline(primarySteamPath);
    drawPipeline(postTurbinePath);
    drawPipeline(feedWaterPath);
    drawPipeline(pumpToCorePath);
    
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    drawPipeline(primarySteamPath);
    drawPipeline(postTurbinePath);
    drawPipeline(feedWaterPath);
    drawPipeline(pumpToCorePath);

    // Draw secondary cooling tower pipes (Cyan tinted)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 8;
    drawPipeline(hotCoolingPath);
    drawPipeline(coldCoolingPath);
    
    ctx.strokeStyle = '#020617';
    ctx.lineWidth = 4;
    drawPipeline(hotCoolingPath);
    drawPipeline(coldCoolingPath);

    // 4. Draw Flow Particles inside Pipes
    ctx.lineWidth = 1;
    
    // Steam & Feedwater
    for (let sp of steamParticles) {
        let pCoords = { x: 0, y: 0 };
        let color = '#38bdf8'; // Blue for liquid
        
        if (sp.loop === 'steam') {
            pCoords = getPathPoint(primarySteamPath, sp.progress);
            // steam is hot glowing cyan
            color = '#22d3ee';
        } else {
            // feedwater loop split
            if (sp.progress < 2.0) {
                pCoords = getPathPoint(feedWaterPath, sp.progress);
            } else {
                pCoords = getPathPoint(pumpToCorePath, sp.progress - 2.0);
            }
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pCoords.x, pCoords.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Add glow rings for hot steam
        if (sp.loop === 'steam') {
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
            ctx.strokeRect(pCoords.x - 3, pCoords.y - 3, 6, 6);
        }
    }

    // Cooling loop flow particles
    for (let cp of coolingParticles) {
        let pCoords = { x: 0, y: 0 };
        let color = '#38bdf8'; // cold cooling water
        
        if (cp.loop === 'hot') {
            pCoords = getPathPoint(hotCoolingPath, cp.progress);
            color = '#f43f5e'; // hot return water
        } else {
            pCoords = getPathPoint(coldCoolingPath, cp.progress);
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pCoords.x, pCoords.y, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    // 5. Draw Reactor Core Vessel (Left capsule)
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.8)';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#050b18';
    
    // Render core shell rounded rect
    drawRoundedRect(ctx, coreBounds.x, coreBounds.y, coreBounds.width, coreBounds.height, 20);
    ctx.fill();
    ctx.stroke();

    // Reactor Core internal glow
    const coreGlow = ctx.createRadialGradient(
        coreBounds.x + coreBounds.width/2, coreBounds.y + coreBounds.height/2, 20,
        coreBounds.x + coreBounds.width/2, coreBounds.y + coreBounds.height/2, 120
    );
    if (coreStatus === 'NORMAL') {
        coreGlow.addColorStop(0, 'rgba(16, 185, 129, 0.12)');
        coreGlow.addColorStop(1, 'rgba(16, 185, 129, 0)');
    } else if (coreStatus === 'WARNING') {
        coreGlow.addColorStop(0, 'rgba(245, 158, 11, 0.16)');
        coreGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
    } else {
        coreGlow.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
        coreGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
    }
    ctx.fillStyle = coreGlow;
    drawRoundedRect(ctx, coreBounds.x, coreBounds.y, coreBounds.width, coreBounds.height, 20);
    ctx.fill();

    // Water level inside core (coolant reservoir)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
    const liquidY = 195;
    ctx.beginPath();
    ctx.moveTo(coreBounds.x + 2, liquidY);
    ctx.lineTo(coreBounds.x + coreBounds.width - 2, liquidY);
    ctx.lineTo(coreBounds.x + coreBounds.width - 2, coreBounds.y + coreBounds.height - 20);
    ctx.quadraticCurveTo(coreBounds.x + coreBounds.width - 2, coreBounds.y + coreBounds.height - 2, coreBounds.x + coreBounds.width - 20, coreBounds.y + coreBounds.height - 2);
    ctx.lineTo(coreBounds.x + 20, coreBounds.y + coreBounds.height - 2);
    ctx.quadraticCurveTo(coreBounds.x + 2, coreBounds.y + coreBounds.height - 2, coreBounds.x + 2, coreBounds.y + coreBounds.height - 20);
    ctx.closePath();
    ctx.fill();

    // Draw Static Fuel Rods inside vessel
    for (let rod of fuelRods) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.08)';
        ctx.fillRect(rod.left, rod.top, rod.width, rod.height);

        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rod.left, rod.top, rod.width, rod.height);

        if (rod.pulse > 0) {
            ctx.fillStyle = `rgba(74, 222, 128, ${rod.pulse * 0.25})`;
            ctx.fillRect(rod.left, rod.top, rod.width, rod.height);
            ctx.strokeStyle = `rgba(255, 255, 255, ${rod.pulse * 0.75})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(rod.left, rod.top, rod.width, rod.height);
        }
    }

    // Draw Active Neutrons (sky blue dots bouncing in core container)
    for (let n of neutrons) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Draw Control Rods (Silver/Red descending)
    const currentControlRodDepth = (rodInsertion / 100) * ctrlMaxDepth;
    for (let cr of controlRods) {
        const left = cr.x - cr.width / 2;
        const topY = coreBounds.y;

        // Control rod metal guide
        const grad = ctx.createLinearGradient(left, topY, left + cr.width, topY);
        grad.addColorStop(0, '#475569');
        grad.addColorStop(0.5, '#94a3b8');
        grad.addColorStop(1, '#334155');
        
        ctx.fillStyle = grad;
        ctx.fillRect(left, topY, cr.width, currentControlRodDepth);

        // Absorber tip
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(left, Math.max(topY, topY + currentControlRodDepth - 6), cr.width, 6);
    }

    // 6. Draw Turbine / Generator Casing
    // Turbine shell
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(410, 160);
    ctx.lineTo(490, 160);
    ctx.lineTo(500, 215);
    ctx.lineTo(400, 215);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Turbine shaft rotor blade lines
    ctx.save();
    ctx.translate(450, 187);
    ctx.rotate(turbineAngle);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(0, 18);
        ctx.stroke();
        ctx.rotate(Math.PI / 4);
    }
    // Hub
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Generator housing
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.fillRect(510, 168, 65, 38);
    ctx.strokeRect(510, 168, 65, 38);
    
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Orbitron';
    ctx.fillText('GEN', 530, 192);

    // Electricity sparks to grid
    // Grid pole
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(540, 110); ctx.lineTo(540, 60); // pole vertical
    ctx.moveTo(525, 75);  ctx.lineTo(555, 75);  // crossarm
    ctx.moveTo(528, 60);  ctx.lineTo(552, 60);
    ctx.stroke();

    // Jagged electric arcs when synced and outputting power
    if (generatorSynced && turbineRPM > 2200) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(542, 168);
        
        let py = 168;
        let px = 542;
        while (py > 75) {
            px += (Math.random() - 0.5) * 12;
            py -= 12;
            ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
    }

    // 7. Draw Condenser
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.fillRect(390, 375, 120, 70);
    ctx.strokeRect(390, 375, 120, 70);

    // Draw cooling coil lines inside condenser
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(395, 390 + i * 12);
        ctx.lineTo(505, 390 + i * 12);
        ctx.stroke();
    }
    ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.font = '8px Share Tech Mono';
    ctx.fillText('CONDENSER', 428, 415);

    // 8. Draw Feedwater Pump
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(290, 420, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Pump rotating impeller blades
    ctx.save();
    ctx.translate(290, 420);
    ctx.rotate(pumpAngle);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(5, -6, 2, -12);
        ctx.stroke();
        ctx.rotate((Math.PI * 2) / 3);
    }
    ctx.restore();

    // 9. Draw Cooling Tower (Hyperbolic shell)
    ctx.fillStyle = '#080d1a';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3.5;
    
    ctx.beginPath();
    ctx.moveTo(650, 500); // bottom left
    ctx.bezierCurveTo(690, 480, 690, 320, 675, 280); // left wall
    ctx.lineTo(745, 280); // top rim
    ctx.bezierCurveTo(730, 320, 730, 480, 770, 500); // right wall
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Diagonal structural grid pattern on tower
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
        const heightY = 280 + i * 36;
        ctx.beginPath();
        ctx.moveTo(650 + i * 5, heightY);
        ctx.lineTo(770 - i * 5, heightY);
        ctx.stroke();
    }

    // Cooling water spray inside tower
    if (coolingTowerFan > 15) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
        for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            ctx.arc(680 + Math.random() * 50, 350 + Math.random() * 110, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // 10. Draw Vapor Particles and Sparks
    for (let p of particles) {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Labels for PFD Components
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Orbitron';
    ctx.fillText('REACTOR CORE', 82, 140);
    ctx.fillText('TURBINE', 422, 145);
    ctx.fillText('COOLING TOWER', 655, 270);
    ctx.fillText('FEED PUMP', 255, 450);
}

// Draw rounded rect path helper
function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height - radius);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Animation loop driver
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
            initAudio();
            if (neutrons.length < maxNeutrons) {
                spawnNeutronInCore();
                addLog('[INJECT] Manually inserted thermal neutron into reactor core.', 'system');
            } else {
                addLog('[INJECT] Failed: Core neutron concentration at maximum limit.', 'warning');
            }
        });
    }

    const scramBtn = document.getElementById('scram-btn');
    if (scramBtn) {
        scramBtn.addEventListener('click', () => {
            initAudio();
            isScrammed = true;
            addLog('[SCRAM] EMERGENCY SCRAM ACTIVATED. DRIVING CONTROL SAFETY POISONS!', 'danger');
            
            scramBtn.classList.add('danger-flash');
            
            // Standard SCRAM safety procedure: maximize feedwater speed to cool core
            const pumpSlider = document.getElementById('pump-slider');
            if (pumpSlider) {
                pumpSlider.value = 100;
                feedwaterSpeed = 100;
                document.getElementById('pump-val').textContent = '100%';
                addLog('[SCRAM] Feedwater pump set to 100% capacity to dump core heat.', 'danger');
            }

            // Sync toggle is deactivated
            const syncToggle = document.getElementById('sync-toggle');
            if (syncToggle && syncToggle.checked) {
                syncToggle.checked = false;
                generatorSynced = false;
                document.getElementById('sync-val').textContent = 'OFF';
                document.getElementById('sync-val').style.color = '#64748b';
                document.getElementById('sync-led').className = 'sync-led';
                addLog('[SCRAM] Generator desynced from grid.', 'danger');
            }
            
            if (audioEnabled && audioCtx) {
                try {
                    const now = audioCtx.currentTime;
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(320, now);
                    osc.frequency.linearRampToValueAtTime(80, now + 0.85);
                    
                    gain.gain.setValueAtTime(0.08, now);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
                    
                    osc.start(now);
                    osc.stop(now + 0.95);
                } catch(e) {}
            }
        });
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            initAudio();
            init();
            addLog('[RESET] Plant environment reset. Core parameters at baseline.', 'system');
        });
    }

    // Touch support hooks for audio initiation
    const slidersList = ['rod-slider', 'pump-slider', 'fan-slider'];
    slidersList.forEach(id => {
        const sl = document.getElementById(id);
        if (sl) {
            sl.addEventListener('mousedown', () => initAudio());
            sl.addEventListener('touchstart', () => initAudio());
        }
    });

    const syncEl = document.getElementById('sync-toggle');
    if (syncEl) {
        syncEl.addEventListener('change', (e) => {
            initAudio();
            const synced = e.target.checked;
            if (synced) {
                if (turbineRPM >= 2850 && turbineRPM <= 3150) {
                    addLog('[GRID] Generator successfully synchronized to grid. 50Hz load active.', 'normal');
                } else {
                    addLog('[GRID] WARNING: Generator phase mismatch. Sync attempted outside sync window!', 'warning');
                }
            } else {
                addLog('[GRID] Generator disconnected from grid.', 'system');
            }
        });
    }
}

// Start simulation on load
window.addEventListener('DOMContentLoaded', () => {
    init();
    setupControls();
    requestAnimationFrame(simLoop);
});
