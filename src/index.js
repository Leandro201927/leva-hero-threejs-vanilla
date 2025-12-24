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
let sceneGroup = new THREE.Group(); // Group to hold the entire scene content for rotation
scene.add(sceneGroup);
let coinObject;
let controls;
let composer; // Postprocessing composer
let bloomPass;
let adaptiveQuality;
let gui; // Main GUI instance
let glassMesh; // Mesh for transparency animation
let emissiveMeshes = []; // Meshes for emission animation
let coinMesh; // The Coin001 mesh
let coinAnimationState = 'initial'; // States: 'initial', 'emissive', 'glass', 'coin', 'floating'
let coinAction; // Animation action for Coin001
let coinFloatOffset = 0; // For sinusoidal floating
let coinFinalPosition = null; // Store final position from animation
let mousePos = { x: 0, y: 0 }; // Normalized mouse position (-1 to 1)
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
    scene.background = new THREE.Color(0xd6d6da); // Light gray-white background
    
    // Add fog with custom configuration
    scene.fog = new THREE.Fog(0xd6d6da, 0, 11.5);
    
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
        far: 10.3
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
            sceneGroup.add(model); // Add model to the group instead of scene
            
            // Log the scene structure to help debug
            console.log('Scene structure:');
            
            // Create materials based on performance tier
            const isHighTier = adaptiveQuality?.config.physicalMaterial && adaptiveQuality?.config.postprocessing;
            
            // // 1. Glass Material (Cylinder008_1)
            const glassMaterial = new THREE.MeshBasicMaterial({
                color: 0x0bbae6,
                transparent: false,
                opacity: 0.85,
                roughness: 0.1,
                metalness: 0.5
            });
            // let glassMaterial;
            // if (isHighTier) {
            //     // High Quality: Custom Glass Shader
            //     glassMaterial = new THREE.ShaderMaterial({
            //         uniforms: {
            //             color: { value: new THREE.Color(0x0bbae6) },
            //             opacity: { value: 0.15 }
            //         },
            //         vertexShader: `
            //             varying vec3 vNormal;
            //             varying vec3 vViewPosition;
            //             void main() {
            //                 vNormal = normalize(normalMatrix * normal);
            //                 vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            //                 vViewPosition = -mvPosition.xyz;
            //                 gl_Position = projectionMatrix * mvPosition;
            //             }
            //         `,
            //         fragmentShader: `
            //             uniform vec3 color;
            //             uniform float opacity;
            //             varying vec3 vNormal;
            //             varying vec3 vViewPosition;
            //             void main() {
            //                 vec3 normal = normalize(vNormal);
            //                 vec3 viewDir = normalize(vViewPosition);
            //                 float fresnel = pow(1.0 - dot(normal, viewDir), 2.0); // Soft Fresnel
            //                 float alpha = opacity + fresnel * 0.3;
            //                 gl_FragColor = vec4(mix(color, vec3(1.0), fresnel), alpha);
            //             }
            //         `,
            //         transparent: true,
            //     });
            // } else {
            //     // Lower Quality: Translucent Standard Material
            //     glassMaterial = new THREE.MeshStandardMaterial({
            //         color: 0x0bbae6,
            //         transparent: true,
            //         opacity: 0.15,
            //         roughness: 0.1,
            //         metalness: 0.5
            //     });
            // }

            // 2. Emissive Material (Curves)
            const emissiveMaterial = new THREE.MeshStandardMaterial({
                color: 0x000000, // Base color dark
                emissive: 0x0bbae6,
                emissiveIntensity: 1.1,
                roughness: 1,
                metalness: 0.8
            });

            // Apply custom material to Coin001 with JPG envMap (using standard TextureLoader)
            const pmremGenerator = new THREE.PMREMGenerator(renderer);
            pmremGenerator.compileEquirectangularShader();

            let coinMaterial;

            new THREE.TextureLoader().load('./assets/gradiente-white-blue-fucsia.jpg', (texture) => {
                console.log('🌈 JPG loaded for Coin envMap');
                texture.colorSpace = THREE.SRGBColorSpace;
                const envMap = pmremGenerator.fromEquirectangular(texture).texture;
                
                // Using MeshStandardMaterial to support roughness as requested
                coinMaterial = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    envMap: envMap,
                    envMapIntensity: 1.5,
                    roughness: 0.056, // User requested
                    metalness: 0.361    // User requested
                });
                
                // --- CUSTOM SHADER INJECTION FOR ENV MAP ROTATION ---
                
                // Define custom uniform for rotation
                const customUniforms = {
                    uEnvRotX: { value: 0 },
                    uEnvRotY: { value: Math.PI / 2 }, // Initial 90 degrees
                    uEnvRotZ: { value: 271.44 }
                };
                
                coinMaterial.onBeforeCompile = (shader) => {
                    // Link uniforms
                    shader.uniforms.uEnvRotX = customUniforms.uEnvRotX;
                    shader.uniforms.uEnvRotY = customUniforms.uEnvRotY;
                    shader.uniforms.uEnvRotZ = customUniforms.uEnvRotZ;
                    
                    // Inject uniform definition safely
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <common>',
                        '#include <common>\nuniform float uEnvRotX;\nuniform float uEnvRotY;\nuniform float uEnvRotZ;'
                    );
                    
                    // Inject rotation logic into getIBLRadiance function
                    // We use the content of envmap_physical_pars_fragment and modify it
                    if (THREE.ShaderChunk.envmap_physical_pars_fragment) {
                        // Use Regex to be robust against spacing differences
                        const pattern = /vec3\s+reflectVec\s*=\s*reflect\s*\(\s*-\s*viewDir\s*,\s*normal\s*\)\s*;/;
                        
                        const replacement = `vec3 reflectVec = reflect( - viewDir, normal );
                                
                                // Manual Rotation Logic (XYZ Order)
                                float rX = uEnvRotX;
                                float rY = uEnvRotY;
                                float rZ = uEnvRotZ;
                                
                                float cx = cos(rX); float sx = sin(rX);
                                float cy = cos(rY); float sy = sin(rY);
                                float cz = cos(rZ); float sz = sin(rZ);
                                
                                mat3 rotX = mat3(
                                    1.0, 0.0, 0.0,
                                    0.0, cx, sx,
                                    0.0, -sx, cx
                                );
                                
                                mat3 rotY = mat3(
                                    cy, 0.0, sy,
                                    0.0, 1.0, 0.0,
                                    -sy, 0.0, cy
                                );
                                
                                mat3 rotZ = mat3(
                                    cz, -sz, 0.0,
                                    sz, cz, 0.0,
                                    0.0, 0.0, 1.0
                                );
                                
                                // Apply rotations: Z * Y * X
                                reflectVec = rotZ * rotY * rotX * reflectVec;`;

                        const modifiedChunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
                            pattern,
                            replacement
                        );
                        
                        if (modifiedChunk !== THREE.ShaderChunk.envmap_physical_pars_fragment) {
                            shader.fragmentShader = shader.fragmentShader.replace(
                                '#include <envmap_physical_pars_fragment>',
                                modifiedChunk
                            );
                        } else {
                            console.warn('⚠️ Could not find reflectVec pattern in envmap_physical_pars_fragment. Trying fallback injection.');
                            // Fallback: simpler injection that might work if the pattern is slightly different
                            // Just replace the function beginning if possible, but that's risky.
                        }
                    } else {
                        console.warn('Could not find envmap_physical_pars_fragment chunk');
                    }
                    
                    // Store reference to shader
                    coinMaterial.userData.shader = shader;
                };
                
                // Add GUI for Coin Material
                if (gui) {
                    // Remove existing folder if any? (Not checking but assuming clean state)
                    const coinFolder = gui.addFolder('Coin Material');
                    
                    const coinParams = {
                        envMapRotX: 0,
                        envMapRotY: 90,
                        envMapRotZ: 280.44,
                        roughness: 0.312,
                        metalness: 0.361
                    };

                    coinFolder.add(coinParams, 'envMapRotX', 0, 360).name('Env Rotation X').onChange((value) => {
                        customUniforms.uEnvRotX.value = THREE.MathUtils.degToRad(value);
                    });

                    coinFolder.add(coinParams, 'envMapRotY', 0, 360).name('Env Rotation Y').onChange((value) => {
                        customUniforms.uEnvRotY.value = THREE.MathUtils.degToRad(value);
                    });

                    coinFolder.add(coinParams, 'envMapRotZ', 0, 360).name('Env Rotation Z').onChange((value) => {
                        customUniforms.uEnvRotZ.value = THREE.MathUtils.degToRad(value);
                    });

                    coinFolder.add(coinParams, 'roughness', 0, 1).name('Roughness').onChange((value) => {
                        coinMesh.material.roughness = value;
                    });

                    coinFolder.add(coinParams, 'metalness', 0, 1).name('Metalness').onChange((value) => {
                        coinMesh.material.metalness = value;
                    });
                    
                    coinFolder.open();
                }

                model.traverse((child) => {
                    if (child.isMesh) {
                        console.log('Object:', child.name, '| Material:', child.material?.name);
                        
                        if (child.name === 'Cylinder008_2' && child.material?.name === 'Material.003') {
                            console.log(`💎 Aplicando material de VIDRIO a: ${child.name}`);
                            child.material = glassMaterial;
                            // glassMesh = child;
                            child.material = coinMaterial;
                        } 
                        else if (
                            (child.name === 'Curve002' && child.material?.name === 'Material.003') ||
                            (child.name === 'Curve001' && child.material?.name === 'Material.004') ||
                            (child.name === 'Cylinder008_1' && child.material?.name === 'Material.005')
                        ) {
                            // console.log(`✨ Aplicando material EMISIVO a: ${child.name}`);
                            // child.material = emissiveMaterial;
                            // emissiveMeshes.push(child);
                            child.material = coinMaterial;
                        } 
                        else {
                            // Apply baked texture to all other meshes
                            child.material = new THREE.MeshBasicMaterial({ map: bakedTexture });
                        }
                    }
                });
                
                texture.dispose();
                pmremGenerator.dispose();
            }, undefined, (err) => {
                console.error('Error loading EXR:', err);
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
                // console.log('📷 Camera Position:', {
                //     position: {
                //         x: camera.position.x.toFixed(3),
                //         y: camera.position.y.toFixed(3),
                //         z: camera.position.z.toFixed(3)
                //     },
                //     rotation: {
                //         x: camera.rotation.x.toFixed(3),
                //         y: camera.rotation.y.toFixed(3),
                //         z: camera.rotation.z.toFixed(3)
                //     },
                //     target: {
                //         x: controls.target.x.toFixed(3),
                //         y: controls.target.y.toFixed(3),
                //         z: controls.target.z.toFixed(3)
                //     },
                //     zoom: camera.zoom.toFixed(3)
                // });
            });
            
            // Setup animations mixer
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);
                console.log(`Found ${gltf.animations.length} animation(s) in the model`);
                
                // Log all animations for debugging
                gltf.animations.forEach((clip, index) => {
                    console.log(`Animation ${index}:`, clip.name, '| Duration:', clip.duration);
                });
            } else {
                console.warn('No animations found in the model');
            }
            
            // Setup coordinated Coin001 animation sequence
            setupCoin(gltf);
            
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

// Setup coordinated Coin animation sequence
function setupCoin(gltf) {
    // Find Coin001 mesh
    if (!model) {
        console.warn('Model not loaded yet, cannot setup coin');
        return;
    }
    
    coinMesh = model.getObjectByName('Coin001');
    if (!coinMesh) {
        console.warn('Coin001 mesh not found in the model');
        return;
    }
    
    console.log('🪙 Coin001 found, setting up coordinated animation sequence');

    // Apply custom material to Coin001 with JPG envMap (using standard TextureLoader)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    new THREE.TextureLoader().load('./assets/gradiente-white-blue-fucsia.jpg', (texture) => {
        console.log('🌈 JPG loaded for Coin envMap');
        texture.colorSpace = THREE.SRGBColorSpace;
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        
        // Using MeshStandardMaterial to support roughness as requested
        const coinMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            envMap: envMap,
            envMapIntensity: 1.5,
            roughness: 0.056, // User requested
            metalness: 0.361    // User requested
        });
        
        // --- CUSTOM SHADER INJECTION FOR ENV MAP ROTATION ---
        
        // Define custom uniform for rotation
        const customUniforms = {
            uEnvRotX: { value: 0 },
            uEnvRotY: { value: Math.PI / 2 }, // Initial 90 degrees
            uEnvRotZ: { value: 271.44 }
        };
        
        coinMaterial.onBeforeCompile = (shader) => {
            // Link uniforms
            shader.uniforms.uEnvRotX = customUniforms.uEnvRotX;
            shader.uniforms.uEnvRotY = customUniforms.uEnvRotY;
            shader.uniforms.uEnvRotZ = customUniforms.uEnvRotZ;
            
            // Inject uniform definition safely
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                '#include <common>\nuniform float uEnvRotX;\nuniform float uEnvRotY;\nuniform float uEnvRotZ;'
            );
            
            // Inject rotation logic into getIBLRadiance function
            // We use the content of envmap_physical_pars_fragment and modify it
            if (THREE.ShaderChunk.envmap_physical_pars_fragment) {
                // Use Regex to be robust against spacing differences
                const pattern = /vec3\s+reflectVec\s*=\s*reflect\s*\(\s*-\s*viewDir\s*,\s*normal\s*\)\s*;/;
                
                const replacement = `vec3 reflectVec = reflect( - viewDir, normal );
                        
                        // Manual Rotation Logic (XYZ Order)
                        float rX = uEnvRotX;
                        float rY = uEnvRotY;
                        float rZ = uEnvRotZ;
                        
                        float cx = cos(rX); float sx = sin(rX);
                        float cy = cos(rY); float sy = sin(rY);
                        float cz = cos(rZ); float sz = sin(rZ);
                        
                        mat3 rotX = mat3(
                            1.0, 0.0, 0.0,
                            0.0, cx, sx,
                            0.0, -sx, cx
                        );
                        
                        mat3 rotY = mat3(
                            cy, 0.0, sy,
                            0.0, 1.0, 0.0,
                            -sy, 0.0, cy
                        );
                        
                        mat3 rotZ = mat3(
                            cz, -sz, 0.0,
                            sz, cz, 0.0,
                            0.0, 0.0, 1.0
                        );
                        
                        // Apply rotations: Z * Y * X
                        reflectVec = rotZ * rotY * rotX * reflectVec;`;

                const modifiedChunk = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
                    pattern,
                    replacement
                );
                
                if (modifiedChunk !== THREE.ShaderChunk.envmap_physical_pars_fragment) {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <envmap_physical_pars_fragment>',
                        modifiedChunk
                    );
                } else {
                    console.warn('⚠️ Could not find reflectVec pattern in envmap_physical_pars_fragment. Trying fallback injection.');
                    // Fallback: simpler injection that might work if the pattern is slightly different
                    // Just replace the function beginning if possible, but that's risky.
                }
            } else {
                console.warn('Could not find envmap_physical_pars_fragment chunk');
            }
            
            // Store reference to shader
            coinMaterial.userData.shader = shader;
        };
        
        coinMesh.material = coinMaterial;

        // Add GUI for Coin Material
        if (gui) {
            // Remove existing folder if any? (Not checking but assuming clean state)
            const coinFolder = gui.addFolder('Coin Material');
            
            const coinParams = {
                envMapRotX: 0,
                envMapRotY: 90,
                envMapRotZ: 280.44,
                roughness: 0.312,
                metalness: 0.361
            };

            coinFolder.add(coinParams, 'envMapRotX', 0, 360).name('Env Rotation X').onChange((value) => {
                customUniforms.uEnvRotX.value = THREE.MathUtils.degToRad(value);
            });

            coinFolder.add(coinParams, 'envMapRotY', 0, 360).name('Env Rotation Y').onChange((value) => {
                customUniforms.uEnvRotY.value = THREE.MathUtils.degToRad(value);
            });

            coinFolder.add(coinParams, 'envMapRotZ', 0, 360).name('Env Rotation Z').onChange((value) => {
                customUniforms.uEnvRotZ.value = THREE.MathUtils.degToRad(value);
            });

            coinFolder.add(coinParams, 'roughness', 0, 1).name('Roughness').onChange((value) => {
                coinMesh.material.roughness = value;
            });

            coinFolder.add(coinParams, 'metalness', 0, 1).name('Metalness').onChange((value) => {
                coinMesh.material.metalness = value;
            });
            
            coinFolder.open();
        }
        
        texture.dispose();
        pmremGenerator.dispose();
    }, undefined, (err) => {
        console.error('Error loading EXR:', err);
    });
    
    // 1.a. Set initial state: emissiveIntensity at minimum (0.85), glass at max transparency (85%)
    emissiveMeshes.forEach(mesh => {
        if (mesh.material.emissiveIntensity !== undefined) {
            mesh.material.emissiveIntensity = 1;
        }
    });
    
    // if (glassMesh) {
    //     if (glassMesh.material.uniforms) {
    //         glassMesh.material.uniforms.opacity.value = 0.85;
    //     } else {
    //         glassMesh.material.opacity = 0.85;
    //     }
    // }
    
    coinAnimationState = 'initial';
    
    // Find the coin animation from gltf.animations
    if (gltf && gltf.animations && gltf.animations.length > 0) {
        // Search through all animation clips
        const coinClip = gltf.animations.find(clip => {
            // Check if clip name contains 'Coin' or if any track targets Coin001
            const nameMatch = clip.name.toLowerCase().includes('coin');
            const trackMatch = clip.tracks.some(track => 
                track.name.includes('Coin001') || track.name.includes('Coin.001')
            );
            return nameMatch || trackMatch;
        });
        
        if (coinClip && mixer) {
            coinAction = mixer.clipAction(coinClip);
            coinAction.setLoop(THREE.LoopOnce, 1);
            coinAction.clampWhenFinished = true;
            coinAction.stop(); // Don't play yet
            console.log('🪙 Coin animation found:', coinClip.name);
        } else {
            console.warn('Coin animation not found. Available clips:', gltf.animations.map(c => c.name));
        }
    }
    
    // 1.b. Start emissive ease-in after a delay (1 second)
    setTimeout(() => {
        startEmissiveEaseIn();
    }, 1000);
}

// 1.b. Ease-in: Increase emissive intensity from 0.85 to 2 over 500ms
function startEmissiveEaseIn() {
    coinAnimationState = 'emissive';
    console.log('🌟 Starting emissive ease-in');
    
    const startTime = performance.now();
    const duration = 500;
    const startValue = 1;
    const endValue = 1;
    
    function animateEmissive() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease-in function (quadratic)
        const easeProgress = progress * progress;
        const currentValue = startValue + (endValue - startValue) * easeProgress;
        
        emissiveMeshes.forEach(mesh => {
            if (mesh.material.emissiveIntensity !== undefined) {
                mesh.material.emissiveIntensity = currentValue;
            }
        });
        
        if (progress < 1) {
            requestAnimationFrame(animateEmissive);
        } else {
            console.log('✅ Emissive ease-in complete');
            // 1.c. Start glass transparency ease-in
            startGlassEaseIn();
        }
    }
    
    animateEmissive();
}

// 1.c. Ease-in: Decrease glass transparency from 85% to 15% over 500ms
function startGlassEaseIn() {
    coinAnimationState = 'glass';
    console.log('💎 Starting glass transparency ease-in');
    
    if (!glassMesh) {
        console.warn('Glass mesh not found, skipping to coin animation');
        startCoinAnimation();
        return;
    }
    
    const startTime = performance.now();
    const duration = 500;
    const startValue = 0.85;
    const endValue = 0.5;
    
    function animateGlass() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease-in function (quadratic)
        const easeProgress = progress * progress;
        const currentValue = startValue + (endValue - startValue) * easeProgress;
        
        if (glassMesh.material.uniforms) {
            glassMesh.material.uniforms.opacity.value = currentValue;
        } else {
            glassMesh.material.opacity = currentValue;
        }
        
        if (progress < 1) {
            requestAnimationFrame(animateGlass);
        } else {
            console.log('✅ Glass transparency ease-in complete');
            // 1.d. Start coin animation
            startCoinAnimation();
        }
    }
    
    animateGlass();
}

// 1.d. Play Coin001 animation once
function startCoinAnimation() {
    coinAnimationState = 'coin';
    console.log('🪙 Starting Coin001 animation (once)');
    
    if (!coinAction) {
        console.warn('Coin animation not available, starting floating immediately');
        startFloatingAnimation();
        return;
    }
    
    // Play animation from the start
    coinAction.reset();
    coinAction.play();
    
    // Listen for when the animation finishes
    mixer.addEventListener('finished', onCoinAnimationFinished);
}

// 1.e. Handle coin animation finish, capture final position
function onCoinAnimationFinished(event) {
    if (event.action === coinAction) {
        console.log('✅ Coin001 animation finished');
        
        // Remove listener to avoid multiple calls
        mixer.removeEventListener('finished', onCoinAnimationFinished);
        
        // 1.e. Store the final position of the coin
        if (coinMesh) {
            coinFinalPosition = {
                x: coinMesh.position.x,
                y: coinMesh.position.y,
                z: coinMesh.position.z
            };
            console.log('📍 Final coin position captured:', coinFinalPosition);
        }
        
        // 1.f. Start floating animation
        startFloatingAnimation();
    }
}

// 1.f. Floating animation with cursor-following rotation
function startFloatingAnimation() {
    coinAnimationState = 'floating';
    console.log('🎈 Starting floating animation with cursor tracking');
    
    // If we don't have a final position, use current position
    if (!coinFinalPosition && coinMesh) {
        coinFinalPosition = {
            x: coinMesh.position.x,
            y: coinMesh.position.y,
            z: coinMesh.position.z
        };
    }
}

// Mouse move listener for cursor tracking
function onMouseMove(event) {
    // Normalize mouse position to -1 to 1
    mousePos.x = (event.clientX / window.innerWidth) * 2 - 1;
    mousePos.y = -(event.clientY / window.innerHeight) * 2 + 1;
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

    // Only run continuous animations if NOT in coordinated coin sequence (or after floating starts)
    if (coinAnimationState === 'floating' || coinAnimationState === 'initial') {
        // 1. Glass Transparency Animation (15% to 85%) - only if in floating state and we want it to continue
        // For now, keep glass at 15% after sequence completes
        if (glassMesh && coinAnimationState !== 'floating') {
            const targetOpacity = 0.15 + (0.85 - 0.15) * easeInOut;
            if (glassMesh.material.uniforms) {
                // ShaderMaterial
                glassMesh.material.uniforms.opacity.value = targetOpacity;
            } else {
                // StandardMaterial
                glassMesh.material.opacity = targetOpacity;
            }
        }

        // 2. Emission Animation (Cyan on/off) - only if in floating state and we want it to continue
        // For now, keep emission at max (2.0) after sequence completes
        // if (coinAnimationState !== 'floating') {
        //     emissiveMeshes.forEach(mesh => {
        //         if (mesh.material.emissiveIntensity !== undefined) {
        //             mesh.material.emissiveIntensity = 0.85 + (easeInOut * 1.05); // Scale intensity for better glow
        //         }
        //     });
        // }
    }
    
    // 1.f. Floating animation with cursor-following rotation (when in floating state)
    if (coinAnimationState === 'floating' && coinMesh && coinFinalPosition) {
        // Sinusoidal vertical floating (starts by going up)
        coinFloatOffset += delta * 0.5; // Control speed of floating
        const floatAmplitude = 0.15; // Amplitude of the float (how much it moves up/down)
        const floatY = Math.sin(coinFloatOffset) * floatAmplitude;
        
        // Apply smooth ease-in-out to the sine wave
        const rawSin = Math.sin(coinFloatOffset);
        const smoothFloat = rawSin * rawSin * rawSin; // Cubic for smooth ease
        const smoothY = smoothFloat * floatAmplitude;
        
        // Update position: base + floating offset
        coinMesh.position.y = coinFinalPosition.y + smoothY;
        
        // Cursor-following rotation (rotate against cursor direction)
        // Calculate rotation based on mouse position (inverted for "looking at cursor" effect)
        const rotationSpeed = 0.5; // How much the coin rotates based on cursor
        const targetRotationY = -mousePos.x * rotationSpeed;
        const targetRotationX = mousePos.y * rotationSpeed;
        
        // Smooth rotation with ease-in-out
        const rotationDamping = 5; // Lower = smoother/slower
        coinMesh.rotation.y += (targetRotationY - coinMesh.rotation.y) * delta * rotationDamping;
        coinMesh.rotation.x += (targetRotationX - coinMesh.rotation.x) * delta * rotationDamping;
    }

    // --- SMOOTH SCENE ROTATION BASED ON CURSOR ---
    if (sceneGroup) {
        // Define rotation intensity (how much the scene tilts)
        const sceneRotationIntensityX = 0.015; // Max rotation on X axis (radians)
        const sceneRotationIntensityY = 0.05; // Max rotation on Y axis (radians)
        
        // Calculate target rotation based on mouse position
        // mousePos.x is -1 to 1, mousePos.y is -1 to 1
        // We want the scene to rotate IN the direction of the cursor
        const targetSceneRotY = mousePos.x * sceneRotationIntensityY;
        const targetSceneRotX = -mousePos.y * sceneRotationIntensityX; // Invert Y because screen Y is top-down
        
        // Smoothly interpolate current rotation to target rotation
        const sceneDamping = 2.0; // Lower = smoother/slower response
        
        sceneGroup.rotation.y += (targetSceneRotY - sceneGroup.rotation.y) * delta * sceneDamping;
        sceneGroup.rotation.x += (targetSceneRotX - sceneGroup.rotation.x) * delta * sceneDamping;
    }
    
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
    window.addEventListener('mousemove', onMouseMove);
}

// Start the application
init();
