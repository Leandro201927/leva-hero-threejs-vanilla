import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';

// Scene setup
const scene = new THREE.Scene();
let camera;
let renderer;
let mixer;
let model;
let coinObject;
let controls;
let composer; // Postprocessing composer
let bloomPass;
let adaptiveQuality;
let gui; // Main GUI instance
let glassMesh; // Mesh for transparency animation
let emissiveMeshes = []; // Meshes for emission animation
const textureLoader = new THREE.TextureLoader();
const bakedTexture = textureLoader.load('./assets/baked_final.jpg');
bakedTexture.flipY = false;
bakedTexture.colorSpace = THREE.SRGBColorSpace;
bakedTexture.minFilter = THREE.LinearFilter;
bakedTexture.magFilter = THREE.LinearFilter;
bakedTexture.generateMipmaps = false;

// Detector de capacidades optimizado
class PerformanceDetector {
  constructor() {
    this.tier = this.detectTier();
  }

  detectTier() {
    // 1. Chequeos básicos instantáneos
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const hardwareConcurrency = navigator.hardwareConcurrency || 2;
    const deviceMemory = navigator.deviceMemory || 4; // GB (Chrome/Edge)
    
    // 2. Capacidades WebGL
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (!gl) return 'low';
    
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxVertexUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
    
    // 3. Sistema de scoring
    let score = 0;
    
    // Penalizar móviles fuertemente
    if (isMobile) score -= 30;
    
    // CPU cores
    if (hardwareConcurrency >= 8) score += 20;
    else if (hardwareConcurrency >= 4) score += 10;
    
    // RAM
    if (deviceMemory >= 8) score += 15;
    else if (deviceMemory >= 4) score += 5;
    
    // Capacidades WebGL
    if (maxTextureSize >= 16384) score += 20;
    else if (maxTextureSize >= 8192) score += 10;
    
    if (maxVertexUniforms >= 512) score += 10;
    
    // WebGL2
    if (gl instanceof WebGL2RenderingContext) score += 15;
    
    // Extensiones importantes
    const extensions = [
      'EXT_color_buffer_float',
      'OES_texture_float_linear',
      'EXT_texture_filter_anisotropic'
    ];
    
    extensions.forEach(ext => {
      if (gl.getExtension(ext)) score += 5;
    });
    
    // 4. Clasificación
    if (score >= 50) return 'high';
    if (score >= 20) return 'medium';
    return 'low';
  }

  getConfig() {
    const configs = {
      high: {
        shadows: true,
        shadowMapSize: 2048,
        antialias: true,
        physicalMaterial: true,
        postprocessing: true,
        pixelRatio: Math.min(window.devicePixelRatio, 2)
      },
      medium: {
        shadows: true,
        shadowMapSize: 1024,
        antialias: true,
        physicalMaterial: true,
        postprocessing: false,
        pixelRatio: Math.min(window.devicePixelRatio, 1.5)
      },
      low: {
        shadows: false,
        shadowMapSize: 512,
        antialias: false,
        physicalMaterial: false,
        postprocessing: false,
        pixelRatio: 1
      }
    };
    
    return configs[this.tier];
  }
}

// Monitoreo adaptativo de calidad
class AdaptiveQuality {
  constructor(renderer, initialConfig) {
    this.renderer = renderer;
    this.config = initialConfig;
    this.frameCount = 0;
    this.fpsHistory = [];
    this.lastTime = performance.now();
    this.fps = 60;
  }
  
  monitor() {
    this.frameCount++;
    
    // Calcular FPS
    const currentTime = performance.now();
    const delta = currentTime - this.lastTime;
    this.fps = 1000 / delta;
    this.lastTime = currentTime;
    
    // Revisar cada 60 frames
    if (this.frameCount % 60 === 0) {
      this.fpsHistory.push(this.fps);
      
      // Mantener solo últimos 5 samples
      if (this.fpsHistory.length > 5) {
        this.fpsHistory.shift();
      }
      
      const avgFps = this.fpsHistory.reduce((a, b) => a + b) / this.fpsHistory.length;
      
      // Ajustar calidad automáticamente
      if (avgFps < 25 && this.config.shadows) {
        console.log('⚠️ FPS bajo, reduciendo calidad...');
        this.config.shadows = false;
        this.config.shadowMapSize = 512;
        
        // Deshabilitar postprocessing si está activo
        if (this.config.postprocessing && composer) {
          this.config.postprocessing = false;
          console.log('⚠️ Deshabilitando postprocessing...');
        }
      }
    }
  }
}

// Initialize renderer
function initRenderer() {
    // Detect performance tier
    const detector = new PerformanceDetector();
    const config = detector.getConfig();
    
    console.log(`🎮 Tier detectado: ${detector.tier}`);
    console.log('⚙️ Config:', config);
    
    renderer = new THREE.WebGLRenderer({ 
        antialias: config.antialias,
        alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(config.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    
    // Enable shadows if config allows
    if (config.shadows) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    
    const container = document.getElementById('canvas-container');
    container.appendChild(renderer.domElement);
    
    // Initialize adaptive quality monitoring
    adaptiveQuality = new AdaptiveQuality(renderer, config);
    
    // Note: postprocessing setup moved to loadModel() after camera is ready
}

// Setup postprocessing with bloom
function setupPostprocessing() {
    // Create composer
    composer = new EffectComposer(renderer);
    
    // Add render pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // Add bloom pass
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5,  // strength
        0.4,  // radius
        0.85  // threshold
    );
    composer.addPass(bloomPass);
    
    console.log('✨ Postprocessing habilitado con bloom');
    
    // Add bloom GUI controls
    addBloomGUI();
}

// Setup lighting with RoomEnvironment
function setupLighting() {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    const environment = new RoomEnvironment();
    const envMap = pmremGenerator.fromScene(environment).texture;
    
    scene.environment = envMap;
    scene.background = new THREE.Color(0xebe8e8); // Light gray-white background
    
    // Add fog with custom configuration
    scene.fog = new THREE.Fog(0xebe8e8, 0, 11.5);
    
    environment.dispose();
    pmremGenerator.dispose();
    
    // Setup GUI for fog controls
    setupFogGUI();
}

// Setup GUI for fog parameters
function setupFogGUI() {
    gui = new GUI();
    gui.title('Scene Controls');
    
    // Fog folder
    const fogFolder = gui.addFolder('Fog');
    
    const fogParams = {
        enabled: true,
        color: '#ebe8e8',
        near: 0,
        far: 11.5
    };
    
    fogFolder.add(fogParams, 'enabled').name('Enable Fog').onChange((value) => {
        if (value) {
            scene.fog = new THREE.Fog(
                new THREE.Color(fogParams.color),
                fogParams.near,
                fogParams.far
            );
        } else {
            scene.fog = null;
        }
    });
    
    fogFolder.addColor(fogParams, 'color').name('Fog Color').onChange((value) => {
        if (scene.fog) {
            scene.fog.color.set(value);
            scene.background.set(value);
        }
    });
    
    fogFolder.add(fogParams, 'near', 0, 50, 0.1).name('Fog Near').onChange((value) => {
        if (scene.fog) {
            scene.fog.near = value;
        }
    });
    
    fogFolder.add(fogParams, 'far', 0, 100, 0.1).name('Fog Far').onChange((value) => {
        if (scene.fog) {
            scene.fog.far = value;
        }
    });
    
    console.log('Fog GUI controls added');
}

// Add bloom controls to GUI (called after postprocessing is setup)
function addBloomGUI() {
    if (!gui || !bloomPass) return;
    
    const bloomFolder = gui.addFolder('Bloom');
    
    const bloomParams = {
        enabled: true,
        strength: 1.5,
        radius: 0.4,
        threshold: 0.85
    };
    
    bloomFolder.add(bloomParams, 'enabled').name('Enable Bloom').onChange((value) => {
        if (bloomPass) {
            bloomPass.enabled = value;
        }
    });
    
    bloomFolder.add(bloomParams, 'strength', 0, 3, 0.01).name('Strength').onChange((value) => {
        if (bloomPass) {
            bloomPass.strength = value;
        }
    });
    
    bloomFolder.add(bloomParams, 'radius', 0, 1, 0.01).name('Radius').onChange((value) => {
        if (bloomPass) {
            bloomPass.radius = value;
        }
    });
    
    bloomFolder.add(bloomParams, 'threshold', 0, 1, 0.01).name('Threshold').onChange((value) => {
        if (bloomPass) {
            bloomPass.threshold = value;
        }
    });
    
    bloomFolder.open();
    
    console.log('✨ Bloom GUI controls added');
}

// Load GLB model
function loadModel() {
    const loader = new GLTFLoader();
    
    // Setup DRACOLoader for compressed models
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    loader.setDRACOLoader(dracoLoader);
    
    const loadingElement = document.getElementById('loading');
    
    loader.load(
        './assets/v3 __.glb',
        (gltf) => {
            console.log('Model loaded successfully');
            model = gltf.scene;
            scene.add(model);
            
            // Log the scene structure to help debug
            console.log('Scene structure:');
            
            // Create materials based on performance tier
            const isHighTier = adaptiveQuality?.config.physicalMaterial && adaptiveQuality?.config.postprocessing;
            
            // 1. Glass Material (Cylinder008_1)
            let glassMaterial;
            if (isHighTier) {
                // High Quality: Custom Glass Shader
                glassMaterial = new THREE.ShaderMaterial({
                    uniforms: {
                        color: { value: new THREE.Color(0x0bbae6) },
                        opacity: { value: 0.15 }
                    },
                    vertexShader: `
                        varying vec3 vNormal;
                        varying vec3 vViewPosition;
                        void main() {
                            vNormal = normalize(normalMatrix * normal);
                            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                            vViewPosition = -mvPosition.xyz;
                            gl_Position = projectionMatrix * mvPosition;
                        }
                    `,
                    fragmentShader: `
                        uniform vec3 color;
                        uniform float opacity;
                        varying vec3 vNormal;
                        varying vec3 vViewPosition;
                        void main() {
                            vec3 normal = normalize(vNormal);
                            vec3 viewDir = normalize(vViewPosition);
                            float fresnel = pow(1.0 - dot(normal, viewDir), 2.0); // Soft Fresnel
                            float alpha = opacity + fresnel * 0.3;
                            gl_FragColor = vec4(mix(color, vec3(1.0), fresnel), alpha);
                        }
                    `,
                    transparent: true,
                });
            } else {
                // Lower Quality: Translucent Standard Material
                glassMaterial = new THREE.MeshStandardMaterial({
                    color: 0x0bbae6,
                    transparent: true,
                    opacity: 0.15,
                    roughness: 0.1,
                    metalness: 0.5
                });
            }

            // 2. Emissive Material (Curves)
            const emissiveMaterial = new THREE.MeshStandardMaterial({
                color: 0x000000, // Base color dark
                emissive: 0x0bbae6,
                emissiveIntensity: 1,
                roughness: 0.3,
                metalness: 0.8
            });

            model.traverse((child) => {
                if (child.isMesh) {
                    console.log('Object:', child.name, '| Material:', child.material?.name);
                    
                    if (child.name === 'Cylinder008_2' && child.material?.name === 'Material.003') {
                        console.log(`💎 Aplicando material de VIDRIO a: ${child.name}`);
                        child.material = glassMaterial;
                        glassMesh = child;
                    } 
                    else if (
                        (child.name === 'Curve002' && child.material?.name === 'Material.003') ||
                        (child.name === 'Curve001' && child.material?.name === 'Material.004') ||
                        (child.name === 'Cylinder008_1' && child.material?.name === 'Material.005')
                    ) {
                        console.log(`✨ Aplicando material EMISIVO a: ${child.name}`);
                        child.material = emissiveMaterial;
                        emissiveMeshes.push(child);
                    } 
                    else {
                        // Apply baked texture to all other meshes
                        child.material = new THREE.MeshBasicMaterial({ map: bakedTexture });
                    }
                }
            });
            
            // Find and use camera from the model
            const modelCamera = model.getObjectByName('Camera');
            if (modelCamera && modelCamera.isCamera) {
                // If it's an orthographic camera from Blender
                if (modelCamera.isOrthographicCamera) {
                    camera = modelCamera;
                    
                    // Update frustum based on viewport aspect ratio
                    const aspect = window.innerWidth / window.innerHeight;
                    const frustumSize = camera.top - camera.bottom; // Get original frustum size
                    
                    camera.left = -frustumSize * aspect / 2;
                    camera.right = frustumSize * aspect / 2;
                    camera.top = frustumSize / 2;
                    camera.bottom = -frustumSize / 2;
                    
                    // Apply custom camera settings
                    camera.position.set(4.078, 2.260, 3.643);
                    camera.rotation.set(-2.707, 0.071, 3.109);
                    camera.zoom = 1.228;
                    
                    camera.updateProjectionMatrix();
                    console.log('Using orthographic camera from model:', camera.name);
                    console.log('Camera frustum:', { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom });
                    console.log('Applied custom camera position and zoom');
                } else {
                    // If it's a perspective camera, convert it to orthographic
                    const aspect = window.innerWidth / window.innerHeight;
                    const frustumSize = 5; // Default frustum size
                    
                    camera = new THREE.OrthographicCamera(
                        -frustumSize * aspect / 2,
                        frustumSize * aspect / 2,
                        frustumSize / 2,
                        -frustumSize / 2,
                        0.1,
                        1000
                    );
                    
                    // Apply custom camera settings
                    camera.position.set(4.078, 2.260, 3.643);
                    camera.rotation.set(-2.707, 0.071, 3.109);
                    camera.zoom = 1.228;
                    
                    camera.updateProjectionMatrix();
                    console.log('Converted perspective camera to orthographic');
                    console.log('Applied custom camera position and zoom');
                }
            } else {
                // Fallback orthographic camera if not found in model
                console.warn('Camera not found in model, using default orthographic camera');
                const aspect = window.innerWidth / window.innerHeight;
                const frustumSize = 5;
                
                camera = new THREE.OrthographicCamera(
                    -frustumSize * aspect / 2,
                    frustumSize * aspect / 2,
                    frustumSize / 2,
                    -frustumSize / 2,
                    0.1,
                    1000
                );
                
                // Apply custom camera settings
                camera.position.set(4.078, 2.260, 3.643);
                camera.rotation.set(-2.707, 0.071, 3.109);
                camera.zoom = 1.228;
                
                camera.updateProjectionMatrix();
                console.log('Applied custom camera position and zoom');
            }
            
            // Setup OrbitControls
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.screenSpacePanning = false;
            controls.minDistance = 1;
            controls.maxDistance = 100;
            
            // Set custom target position
            controls.target.set(3.694, 0.000, 8.516);
            controls.update();
            
            console.log('OrbitControls enabled with custom target');
            
            // Log camera position/rotation when controls change
            controls.addEventListener('change', () => {
                console.log('📷 Camera Position:', {
                    position: {
                        x: camera.position.x.toFixed(3),
                        y: camera.position.y.toFixed(3),
                        z: camera.position.z.toFixed(3)
                    },
                    rotation: {
                        x: camera.rotation.x.toFixed(3),
                        y: camera.rotation.y.toFixed(3),
                        z: camera.rotation.z.toFixed(3)
                    },
                    target: {
                        x: controls.target.x.toFixed(3),
                        y: controls.target.y.toFixed(3),
                        z: controls.target.z.toFixed(3)
                    },
                    zoom: camera.zoom.toFixed(3)
                });
            });
            
            // Find the Coin object and setup animation
            coinObject = model.getObjectByName('Coin');
            if (coinObject) {
                console.log('Coin object found:', coinObject.name);
            } else {
                console.warn('Coin object not found in the model');
            }
            
            // Setup animations
            /*
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);
                
                // Find animation related to Coin or play all animations
                gltf.animations.forEach((clip, index) => {
                    console.log(`Animation ${index}:`, clip.name, '| Duration:', clip.duration);
                    
                    // Check if this animation affects the Coin object
                    const isCoinAnimation = clip.tracks.some(track => 
                        track.name.includes('Coin')
                    );
                    
                    if (isCoinAnimation || gltf.animations.length === 1) {
                        const action = mixer.clipAction(clip);
                        action.setLoop(THREE.LoopRepeat, Infinity);
                        action.play();
                        console.log('Playing animation:', clip.name);
                    }
                });
                
                // If no specific Coin animation found, play all animations
                if (mixer._actions.length === 0 && gltf.animations.length > 0) {
                    console.log('No Coin-specific animation found, playing all animations');
                    gltf.animations.forEach(clip => {
                        const action = mixer.clipAction(clip);
                        action.setLoop(THREE.LoopRepeat, Infinity);
                        action.play();
                    });
                }
            } else {
                console.warn('No animations found in the model');
            }
            */
            
            // Setup postprocessing if enabled (after camera is ready)
            if (adaptiveQuality?.config.postprocessing) {
                // setupPostprocessing();
            }
            
            // Hide loading screen
            loadingElement.classList.add('hidden');
            
            // Start animation loop
            animate();
        },
        (progress) => {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            console.log(`Loading: ${percent}%`);
        },
        (error) => {
            console.error('Error loading model:', error);
            loadingElement.innerHTML = `
                <div class="spinner"></div>
                <div>Error loading 3D model</div>
                <div style="font-size: 14px; color: #ff6b6b;">${error.message}</div>
            `;
        }
    );
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update animation mixer
    if (mixer) {
        mixer.update(delta);
    }
    
    // Update controls
    if (controls) {
        controls.update();
    }
    
    // Monitor adaptive quality
    if (adaptiveQuality) {
        adaptiveQuality.monitor();
    }

    // Update custom animations (Ease-in-out)
    const time = clock.getElapsedTime();
    const cycle = (Math.sin(time * 2.0) + 1.0) / 2.0; // 0 to 1 value
    const easeInOut = cycle * cycle * (3.0 - 2.0 * cycle); // Simple cubic ease-in-out

    // 1. Glass Transparency Animation (15% to 70%)
    if (glassMesh) {
        const targetOpacity = 0.15 + (0.70 - 0.15) * easeInOut;
        if (glassMesh.material.uniforms) {
            // ShaderMaterial
            glassMesh.material.uniforms.opacity.value = targetOpacity;
        } else {
            // StandardMaterial
            glassMesh.material.opacity = targetOpacity;
        }
    }

    // 2. Emission Animation (Cyan on/off)
    emissiveMeshes.forEach(mesh => {
        if (mesh.material.emissiveIntensity !== undefined) {
            mesh.material.emissiveIntensity = easeInOut * 2.5; // Scale intensity for better glow
        }
    });
    
    // Render the scene with or without postprocessing
    if (camera) {
        if (composer && adaptiveQuality?.config.postprocessing) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    }
}

// Handle window resize
function onWindowResize() {
    if (camera) {
        if (camera.isOrthographicCamera) {
            const aspect = window.innerWidth / window.innerHeight;
            const frustumSize = camera.top - camera.bottom; // Maintain current frustum size
            
            camera.left = -frustumSize * aspect / 2;
            camera.right = frustumSize * aspect / 2;
            camera.top = frustumSize / 2;
            camera.bottom = -frustumSize / 2;
            
            camera.updateProjectionMatrix();
        } else {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        }
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Update composer size if postprocessing is enabled
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

// Initialize everything
function init() {
    initRenderer();
    setupLighting();
    loadModel();
    
    window.addEventListener('resize', onWindowResize);
}

// Start the application
init();
