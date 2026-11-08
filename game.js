(()=>{
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const stage = $('stage');
  const T = window.THREE;
  if (!T) {
    $('toast').textContent = 'No se pudo cargar el motor 3D.';
    return;
  }

  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new T.Scene();
  scene.background = new T.Color(0x090908);
  scene.fog = new T.FogExp2(0x090908, 0.055);

  const camera = new T.PerspectiveCamera(72, 1, 0.1, 80);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const ambient = new T.HemisphereLight(0x7c857b, 0x1b120e, 0.5);
  scene.add(ambient);

  const flashlightLight = new T.SpotLight(0xffe9b2, 42, 19, Math.PI / 6, 0.62, 1.15);
  flashlightLight.position.set(0, 0, 0);
  flashlightLight.target.position.set(0, 0, -1);
  camera.add(flashlightLight);
  camera.add(flashlightLight.target);

  const fillLight = new T.PointLight(0xc97338, 1.4, 9, 2);
  fillLight.position.set(-2, 2.2, 2.2);
  scene.add(fillLight);

  const itemData = {
    key: ['🗝', 'Llave'],
    food: ['▰', 'Comida'],
    water: ['◉', 'Agua'],
    vaccine: ['✚', 'Vacuna'],
    ammo: ['▪', 'Munición'],
    gun: ['⌁', 'Pistola'],
  };

  const rooms = [
    { name: 'Vestíbulo de servicio', wing: 'Ala de huéspedes · 01', key: 'Llave del ala este', color: 0x393126 },
    { name: 'Pasillo de las habitaciones', wing: 'Ala este · 02', key: 'Llave del comedor', color: 0x3a2d29 },
    { name: 'Comedor de gala', wing: 'Comedor · 03', key: 'Llave de la enfermería', color: 0x34281d },
    { name: 'Enfermería clausurada', wing: 'Enfermería · 04', key: 'Llave del ascensor', color: 0x30302b },
    { name: 'El ascensor', wing: 'Subsuelo · 13', key: null, color: 0x262b29 },
  ];

  const state = {
    roomIndex: 0,
    gameOn: false,
    ended: false,
    inventory: [],
    selected: 0,
    flashlight: true,
    crouching: false,
    running: false,
    hidden: false,
    hideType: null,
    hideExit: null,
    sensitivity: 1,
    player: {
      x: 0, z: 4.8, yaw: 0, pitch: 0,
      hp: 100, food: 100, water: 100, inf: 0,
      ammo: 0, gun: false,
    },
    hint: null,
    roomObj: [],
    roomGroup: null,
    interactables: [],
    obstacles: [],
    enemy: null,
    face: null,
    faceTimer: 0,
    faceCooldown: 4,
    lowDanger: 0,
    pointerLocked: false,
    joy: { x: 0, y: 0, active: false },
    hold: {},
    lastFoot: 0,
    uiTimer: 0,
    lastShot: 0,
    audioCtx: null,
    audioEnabled: true,
  };

  const raycaster = new T.Raycaster();
  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const mats = {};
  const mat = (name, color, rough = 0.85, emissive = 0x000000, emissiveIntensity = 0) => {
    const key = `${name}:${color}:${rough}:${emissive}:${emissiveIntensity}`;
    if (!mats[key]) mats[key] = new T.MeshStandardMaterial({ color, roughness: rough, emissive, emissiveIntensity });
    return mats[key];
  };

  function beep(freq = 180, duration = 0.05, volume = 0.02, type = 'sine') {
    if (!state.audioEnabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!state.audioCtx) state.audioCtx = new AudioCtx();
    const ctx = state.audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = volume;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    o.stop(ctx.currentTime + duration);
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  let toastTimer = 0;

  function resizeRenderer() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resizeRenderer).observe(stage);
  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

  function addMesh(group, obj) {
    group.add(obj);
    state.roomObj.push(obj);
    return obj;
  }

  function createRoom() {
    if (state.roomGroup) scene.remove(state.roomGroup);
    for (const obj of state.roomObj) scene.remove(obj);
    state.roomObj.length = 0;
    state.interactables.length = 0;
    state.obstacles.length = 0;
    state.enemy = null;
    state.face = null;

    const wallMat = mat('wall', rooms[state.roomIndex].color === 0x30302b ? 0x3d3a35 : 0x2d2a27);
    const floorMat = mat('floor' + state.roomIndex, rooms[state.roomIndex].color);
    const trimMat = mat('trim', 0x544a3d);
    const darkMat = mat('dark', 0x171614);

    const roomGroup = new T.Group();
    state.roomGroup = roomGroup;
    scene.add(roomGroup);

    const floor = new T.Mesh(new T.BoxGeometry(15, 0.24, 16), floorMat);
    floor.position.set(0, -0.12, 0);
    roomGroup.add(floor);
    state.roomObj.push(floor);

    const ceiling = new T.Mesh(new T.BoxGeometry(15, 0.24, 16), darkMat);
    ceiling.position.set(0, 3.8, 0);
    roomGroup.add(ceiling);
    state.roomObj.push(ceiling);

    const walls = [
      ['northLeft', [-5.7, 1.8, -7.2], [3.6, 3.6, 0.4]],
      ['northRight', [5.7, 1.8, -7.2], [3.6, 3.6, 0.4]],
      ['northLintel', [0, 3.35, -7.2], [7.8, 0.5, 0.4]],
      ['south', [0, 1.8, 7.2], [15, 3.6, 0.4]],
      ['west', [-7.3, 1.8, 0], [0.4, 3.6, 14.4]],
      ['east', [7.3, 1.8, 0], [0.4, 3.6, 14.4]],
    ];
    for (const [, pos, size] of walls) {
      const wall = new T.Mesh(new T.BoxGeometry(...size), wallMat);
      wall.position.set(...pos);
      roomGroup.add(wall);
      state.roomObj.push(wall);
    }

    const doorFrame = new T.Mesh(new T.BoxGeometry(2.7, 3.0, 0.18), mat('door' + state.roomIndex, 0x2a201a));
    doorFrame.position.set(0, 1.55, -6.96);
    roomGroup.add(doorFrame);
    state.roomObj.push(doorFrame);
    state.interactables.push({ type: 'exit', pos: v3(0, 0, -6.7), object: doorFrame });
    state.obstacles.push({ x: 0, z: -6.8, r: 1.2, door: true });

    // Furniture
    const addFurniture = (x, z, w, d, h, kind = 'table') => {
      const color = kind === 'wardrobe' ? 0x2f2621 : kind === 'cabinet' || kind === 'drawer' ? 0x433b31 : 0x4a3d31;
      const base = mat(kind + state.roomIndex, color);
      let mesh;
      if (kind === 'table' && h <= 1.15) {
        mesh = new T.Mesh(new T.BoxGeometry(w, 0.16, d), base);
        mesh.position.set(x, h - 0.08, z);
        roomGroup.add(mesh);
        state.roomObj.push(mesh);
        for (const ox of [-w * 0.42, w * 0.42]) for (const oz of [-d * 0.38, d * 0.38]) {
          const leg = new T.Mesh(new T.BoxGeometry(0.12, h - 0.16, 0.12), base);
          leg.position.set(x + ox, (h - 0.16) / 2, z + oz);
          roomGroup.add(leg);
          state.roomObj.push(leg);
        }
      } else {
        mesh = new T.Mesh(new T.BoxGeometry(w, h, d), base);
        mesh.position.set(x, h / 2, z);
        roomGroup.add(mesh);
        state.roomObj.push(mesh);
      }
      state.obstacles.push({ x, z, r: Math.max(w, d) * 0.52 });
      if (kind === 'wardrobe') {
        const door = new T.Mesh(new T.BoxGeometry(w * 0.75, h * 0.9, 0.07), mat('wardrobeDoor', 0x4a352d));
        door.position.set(x, h * 0.5, z - d / 2 - 0.04);
        roomGroup.add(door);
        state.roomObj.push(door);
        const handle = new T.Mesh(new T.SphereGeometry(0.05, 12, 12), mat('handle', 0xbca275));
        handle.position.set(x + w * 0.2, h * 0.53, z - d / 2 - 0.08);
        roomGroup.add(handle);
        state.roomObj.push(handle);
        state.interactables.push({ type: 'hide', pos: v3(x, 0, z), object: mesh });
      }
      if (kind === 'table' && h <= 1.15) {
        state.interactables.push({ type: 'hideTable', pos: v3(x, 0, z), object: mesh });
      }
      if (kind === 'drawer') {
        const front = new T.Mesh(new T.BoxGeometry(w * 0.78, 0.24, 0.06), mat('drawerFront', 0x594637));
        front.position.set(x, h * 0.68, z + d / 2 + 0.035);
        roomGroup.add(front);
        state.roomObj.push(front);
        const pull = new T.Mesh(new T.BoxGeometry(0.18, 0.045, 0.06), mat('drawerPull', 0xb49765));
        pull.position.set(x, h * 0.68, z + d / 2 + 0.08);
        roomGroup.add(pull);
        state.roomObj.push(pull);
        state.interactables.push({ type: 'drawer', pos: v3(x, 0, z + d / 2 + 0.3), object: mesh, front, pull, opened: false });
      }
      return mesh;
    };

    if (state.roomIndex === 0) {
      addFurniture(-5.65, -1.2, 1.15, 1.15, 2.4, 'wardrobe');
      addFurniture(5.65, 1.0, 1.15, 1.15, 2.4, 'wardrobe');
      addFurniture(-2.2, -0.5, 2.2, 1.35, 0.78, 'table');
      addFurniture(3.9, 1.0, 1.5, 1.1, 1.05, 'drawer');
      addFurniture(-4.2, 3.2, 1.5, 1.0, 0.72, 'cabinet');
      // Infected plaster and broken furniture make this wing visibly abandoned.
      for (const [x, z, sx, sz] of [[-6.95, -4.8, 0.18, 1.1], [6.95, 4.2, 0.18, 1.35], [-1.4, 3.1, 0.8, 0.22]]) {
        const stain = new T.Mesh(new T.BoxGeometry(sx, 1.5, sz), mat('infectedStain', 0x35402c, 0.98, 0x17220e, 0.18));
        stain.position.set(x, 1.2, z);
        roomGroup.add(stain);
        state.roomObj.push(stain);
      }
      for (const [x, z, rot] of [[-3.5, 1.8, 0.4], [-1.5, 2.4, -0.7], [2.4, -2.4, 0.9], [0.2, 3.8, 0.2]]) {
        const plank = new T.Mesh(new T.BoxGeometry(0.95, 0.12, 0.22), mat('brokenWood', 0x49372a));
        plank.position.set(x, 0.12, z);
        plank.rotation.y = rot;
        roomGroup.add(plank);
        state.roomObj.push(plank);
      }
    } else if (state.roomIndex === 1) {
      addFurniture(-4.2, -1.8, 1.4, 1.25, 2.4, 'wardrobe');
      addFurniture(2.4, -0.2, 2.8, 1.2, 1.1);
      addFurniture(4.5, 3.0, 1.4, 1.2, 0.8, 'cabinet');
    } else if (state.roomIndex === 2) {
      addFurniture(0, -0.5, 4.0, 2.0, 1.0);
      addFurniture(-4.0, 2.6, 1.8, 1.2, 0.8);
      addFurniture(4.7, -2.6, 1.2, 1.2, 2.4, 'wardrobe');
    } else if (state.roomIndex === 3) {
      addFurniture(-3.8, -0.4, 2.1, 1.25, 1.0);
      addFurniture(4.4, -2.0, 1.3, 1.2, 2.4, 'wardrobe');
      addFurniture(0.8, 2.7, 1.4, 1.2, 0.8, 'cabinet');
    } else {
      addFurniture(0, -0.6, 3.8, 2.8, 2.1, 'cabinet');
    }

    const portraits = [
      [-6.9, -3.4], [6.9, -4.2], [6.9, 3.5],
    ];
    for (const [x, z] of portraits) {
      const portrait = new T.Mesh(new T.BoxGeometry(0.09, 1.15, 0.8), mat('portrait', 0x181512));
      portrait.position.set(x, 2.0, z);
      roomGroup.add(portrait);
      state.roomObj.push(portrait);
      const face = new T.Mesh(new T.SphereGeometry(0.18, 12, 12), mat('portraitFace', 0x3a2d27));
      face.position.set(x + (x < 0 ? 0.1 : -0.1), 2.0, z);
      roomGroup.add(face);
      state.roomObj.push(face);
    }

    const pickups =
      state.roomIndex === 0 ? [['key', 3.9, 2.35, 'Llave del ala este'], ['food', -3.0, 2.4, 'Lata sin abrir'], ['water', 2.9, -3.0, 'Agua sellada']] :
      state.roomIndex === 1 ? [['key', -0.9, 3.4, 'Llave del comedor'], ['water', 4.0, 3.2, 'Botella olvidada'], ['ammo', -5.2, 1.5, 'Munición vieja']] :
      state.roomIndex === 2 ? [['key', 5.4, 2.0, 'Llave de la enfermería'], ['food', -4.0, -2.3, 'Ración limpia'], ['vaccine', -4.5, 3.5, 'Vacuna extraña'], ['food', 3.3, -2.2, 'Carne dudosa']] :
      state.roomIndex === 3 ? [['key', 4.2, 2.4, 'Llave del ascensor'], ['vaccine', -5.0, 2.8, 'Vacuna extraña'], ['water', 2.2, -3.0, 'Botella sellada']] :
      [['ammo', -4.2, -2.8, 'Cargador'], ['gun', 4.1, 2.6, 'Pistola vieja']];

    for (const [type, x, z, label] of pickups) {
      const group = new T.Group();
      group.position.set(x, 0.4, z);
      const gem = new T.Mesh(new T.OctahedronGeometry(0.22, 0), mat('item' + type, type === 'key' ? 0xd8b45a : type === 'food' ? 0x9e7448 : type === 'water' ? 0x73a7b7 : type === 'vaccine' ? 0x82bb6e : type === 'gun' ? 0x5c4b42 : 0xb94d3f));
      gem.position.y = 0.28;
      group.add(gem);
      const glow = new T.PointLight(type === 'key' ? 0xe3c97c : 0x7ab2d6, 0.9, 3, 2);
      glow.position.y = 0.5;
      group.add(glow);
      scene.add(group);
      state.roomObj.push(group);
      const inDrawer = state.roomIndex === 0 && type === 'key';
      group.visible = !inDrawer;
      state.interactables.push({ type: 'item', itemType: type, label, pos: v3(x, 0, z), object: group, collected: false, lockedInDrawer: inDrawer });
    }

    if (state.roomIndex < 4) {
      const enemyGroup = new T.Group();
      const patrol = [[-5.3, -5.7], [0, -5.7], [5.3, -5.7], [5.3, 5.7], [0, 5.7], [-5.3, 5.7]];
      enemyGroup.position.set(patrol[0][0], 0, patrol[0][1]);
      const body = new T.Mesh(new T.CapsuleGeometry(0.52, 1.0, 4, 10), mat('monsterBody', 0x2f2120, 0.95));
      body.position.y = 1.1;
      enemyGroup.add(body);
      const head = new T.Mesh(new T.SphereGeometry(0.48, 18, 18), mat('monsterHead', 0x352d2a));
      head.position.y = 2.15;
      enemyGroup.add(head);
      const eyeMat = mat('eye', 0xd4261b, 0.2, 0xa90d11, 2.3);
      const eyeL = new T.Mesh(new T.SphereGeometry(0.07, 10, 10), eyeMat);
      eyeL.position.set(-0.15, 2.15, 0.37);
      enemyGroup.add(eyeL);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.15;
      enemyGroup.add(eyeR);
      scene.add(enemyGroup);
      state.roomObj.push(enemyGroup);
      state.enemy = { group: enemyGroup, x: patrol[0][0], z: patrol[0][1], hp: 2, alive: true, stun: 0, phase: Math.random() * 6, patrol, waypoint: 1, alarmed: false };
    }

    scene.background.set(state.roomIndex === 3 ? 0x10100f : 0x090908);
    scene.fog.color.set(state.roomIndex === 3 ? 0x10100f : 0x090908);

    $('chapter').textContent = rooms[state.roomIndex].wing;
    $('roomLabel').innerHTML = rooms[state.roomIndex].name + '<small>PLANTA BAJA · HOTEL CARNICERÍA</small>';
    updateUI();
  }

  function updateUI() {
    const p = state.player;
    $('healthBar').style.width = Math.max(0, Math.min(100, p.hp)) + '%';
    $('foodBar').style.width = Math.max(0, Math.min(100, p.food)) + '%';
    $('waterBar').style.width = Math.max(0, Math.min(100, p.water)) + '%';
    $('infectionBar').style.width = Math.max(0, Math.min(100, p.inf)) + '%';
    $('healthNum').textContent = Math.round(p.hp);
    $('foodNum').textContent = Math.round(p.food);
    $('waterNum').textContent = Math.round(p.water);
    $('infectionNum').textContent = Math.round(p.inf);

    const inv = $('inventory');
    inv.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === state.selected ? ' selected' : '');
      if (state.inventory[i]) {
        const icon = itemData[state.inventory[i].type]?.[0] || '?';
        const label = itemData[state.inventory[i].type]?.[1] || 'obj';
        slot.innerHTML = icon + '<small>' + label + '</small>';
        slot.title = state.inventory[i].label;
        slot.onclick = () => { state.selected = i; updateUI(); };
      } else {
        slot.classList.add('empty');
        slot.textContent = '·';
      }
      inv.appendChild(slot);
    }

    const hasKey = state.inventory.some((i) => i.type === 'key');
    $('doorState').textContent = state.roomIndex === 4 ? 'SALIDA ABIERTA' : (hasKey ? 'LLAVE ENCONTRADA' : 'PUERTA CERRADA');
    $('weapon').textContent = state.player.gun ? 'PISTOLA · ' + state.player.ammo + ' BALAS' : 'SIN ARMA';

    if (state.roomIndex === 4) {
      $('objective').innerHTML = 'Llega a la puerta norte y escapa del hotel.';
    } else if (hasKey) {
      $('objective').innerHTML = 'La salida está abierta. <b>Dirígete a la puerta norte.</b>';
    } else {
      $('objective').innerHTML = 'Busca <b>' + rooms[state.roomIndex].key + '</b> en esta zona.';
    }
  }

  function addInventory(type, label) {
    if (state.inventory.length >= 5) {
      toast('Inventario lleno. Debes dejar algo antes.');
      return false;
    }
    state.inventory.push({ type, label });
    updateUI();
    return true;
  }

  function useItem() {
    const item = state.inventory[state.selected];
    if (!item) {
      toast('No hay objeto seleccionado.');
      return;
    }

    if (item.type === 'food') {
      state.player.food = Math.min(100, state.player.food + 32);
      state.inventory.splice(state.selected, 1);
      toast('Comes algo y recuperas fuerzas.');
    } else if (item.type === 'water') {
      state.player.water = Math.min(100, state.player.water + 35);
      state.inventory.splice(state.selected, 1);
      toast('Calmas la sed.');
    } else if (item.type === 'vaccine') {
      state.player.inf = Math.max(0, state.player.inf - 55);
      state.player.hp = Math.min(100, state.player.hp + 12);
      state.inventory.splice(state.selected, 1);
      toast('La vacuna sella la infección.');
    } else {
      toast('Eso no sirve ahora mismo.');
      return;
    }

    state.selected = Math.max(0, Math.min(state.selected, state.inventory.length - 1));
    updateUI();
  }

  function nearestInteractable() {
    const forward = new T.Vector3(-Math.sin(state.player.yaw), 0, -Math.cos(state.player.yaw));
    let best = null;
    let bestD = 999;

    for (const it of state.interactables) {
      if (it.type === 'item' && (it.collected || it.lockedInDrawer)) continue;
      const pos = it.pos;
      const dx = pos.x - state.player.x;
      const dz = pos.z - state.player.z;
      const d = Math.hypot(dx, dz);
      const to = new T.Vector3(dx, 0, dz).normalize();
      const dot = to.dot(forward);
      const reach = it.type === 'exit' ? 2.0 : 1.55;
      if (d <= reach && (d < 0.9 || dot > 0.72)) {
        if (d < bestD) { best = it; bestD = d; }
      }
    }
    return best;
  }

  function interactWith(target) {
    if (!target) return;

    if (target.type === 'item') {
      if (!addInventory(target.itemType, target.label)) return;
      target.collected = true;
      target.object.visible = false;
      if (target.itemType === 'ammo') {
        state.player.ammo += 4;
        state.inventory = state.inventory.filter((it) => it.type !== 'ammo');
        toast('Recoges 4 balas.');
      } else if (target.itemType === 'gun') {
        state.player.gun = true;
        state.player.ammo = Math.max(state.player.ammo, 6);
        toast('Pistola recuperada.');
      } else if (target.itemType === 'key') {
        toast('Llave encontrada. La puerta del norte ya tiene sentido.');
      } else {
        toast(target.label + ' recogido.');
      }
      updateUI();
      return;
    }

    if (target.type === 'drawer') {
      if (!target.opened) {
        target.opened = true;
        target.front.position.z += 0.38;
        target.pull.position.z += 0.38;
        for (const item of state.interactables) {
          if (item.type === 'item' && item.lockedInDrawer) {
            item.lockedInDrawer = false;
            item.object.visible = true;
          }
        }
        toast('El cajón se abre. Algo brilla en su interior.');
      } else {
        toast('El cajón está vacío.');
      }
      return;
    }

    if (target.type === 'hide') {
      if (state.hidden && state.hideType === 'wardrobe') {
        state.hidden = false;
        state.hideType = null;
        toast('Sales del armario.');
      } else if (!state.hidden) {
        state.hidden = true;
        state.hideType = 'wardrobe';
        toast('Te escondes en el armario.');
      }
      $('hideNote').classList.toggle('show', state.hidden);
      return;
    }

    if (target.type === 'hideTable') {
      if (state.hidden && state.hideType === 'table') {
        if (state.hideExit) {
          state.player.x = state.hideExit.x;
          state.player.z = state.hideExit.z;
        }
        state.hideExit = null;
        state.hidden = false;
        state.hideType = null;
        toast('Sales de debajo de la mesa.');
      } else if (state.crouching && !state.hidden) {
        state.hideExit = { x: state.player.x, z: state.player.z };
        state.player.x = target.pos.x;
        state.player.z = target.pos.z;
        state.hidden = true;
        state.hideType = 'table';
        toast('Te ocultas bajo la mesa. No hagas ruido.');
      } else {
        toast('Agáchate primero para meterte bajo la mesa.');
      }
      $('hideNote').classList.toggle('show', state.hidden);
      return;
    }

    if (target.type === 'exit') {
      const keyIndex = state.inventory.findIndex((i) => i.type === 'key');
      if (state.roomIndex < 4 && keyIndex < 0) {
        toast('La puerta está cerrada; falta una llave.');
        return;
      }
      if (keyIndex >= 0) state.inventory.splice(keyIndex, 1);
      if (state.roomIndex === 4) {
        finish(true);
        return;
      }
      $('fade').classList.add('show');
      setTimeout(() => {
        $('fade').classList.remove('show');
        state.roomIndex += 1;
        state.player.x = 0;
        state.player.z = 4.7;
        state.player.yaw = 0;
        createRoom();
        toast(rooms[state.roomIndex].name + '. No te detengas.');
      }, 420);
      return;
    }
  }

  function finish(win) {
    state.ended = true;
    state.gameOn = false;
    document.exitPointerLock?.();
    $('endTitle').textContent = win ? 'AMANECE EN EL PISO 13' : 'EL HOTEL TE RETIENE';
    $('endText').textContent = win ? 'La puerta del montacargas cede. El pasillo no tiene ojos ni pasos: tú has salido.' : 'La cara del hotel sigue en la oscuridad y tú desapareces entre sus paredes.';
    $('ending').classList.remove('hidden');
  }

  function startGame() {
    if (state.gameOn) return;
    state.player = { x: 0, z: 4.8, yaw: 0, pitch: 0, hp: 100, food: 100, water: 100, inf: 0, ammo: 0, gun: false };
    state.inventory = [];
    state.selected = 0;
    state.flashlight = true;
    state.hidden = false;
    state.hideType = null;
    state.hideExit = null;
    state.crouching = false;
    state.running = false;
    state.roomIndex = 0;
    state.gameOn = true;
    state.ended = false;
    $('intro').classList.add('hidden');
    $('ending').classList.add('hidden');
    $('hideNote').classList.remove('show');
    createRoom();
    updateUI();
    toast('Encuentra la llave del ala este.');
    if (window.matchMedia('(pointer:fine)').matches) canvas.requestPointerLock?.();
  }

  function shiftPressed(code) {
    return !!state.hold[code];
  }

  function canMove(x, z) {
    if (x < -6.35 || x > 6.35 || z < -6.35 || z > 6.35) return false;
    for (const obstacle of state.obstacles) {
      if (Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.r + 0.28) {
        return false;
      }
    }
    return true;
  }

  function createFace() {
    const g = new T.Group();
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 128);
    grad.addColorStop(0, 'rgba(240,220,200,0.97)');
    grad.addColorStop(0.5, 'rgba(160,140,125,0.85)');
    grad.addColorStop(1, 'rgba(18,14,12,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#0d0c0c';
    ctx.beginPath(); ctx.ellipse(82, 104, 24, 32, -0.25, 0, Math.PI * 2); ctx.ellipse(174, 104, 24, 32, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d53725';
    ctx.beginPath(); ctx.arc(82, 108, 8, 0, Math.PI * 2); ctx.arc(174, 108, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1c1211';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.ellipse(128, 176, 40, 20, 0, 0, Math.PI * 2); ctx.stroke();
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const material = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.94, side: T.DoubleSide, depthWrite: false });
    const mesh = new T.Mesh(new T.PlaneGeometry(1.8, 1.8), material);
    mesh.visible = false;
    g.add(mesh);
    scene.add(g);
    state.roomObj.push(g);
    state.face = g;
    return g;
  }

  function maybeFaces() {
    if (!state.gameOn || !state.flashlight) return;
    state.faceCooldown -= 1 / 60;
    if (state.faceCooldown > 0) return;
    const dir = new T.Vector3(-Math.sin(state.player.yaw), Math.sin(state.player.pitch), -Math.cos(state.player.yaw)).normalize();
    raycaster.set(camera.position, dir);
    raycaster.far = 10;
    const hits = raycaster.intersectObjects(state.roomObj, true);
    const wallHit = hits.find((h) => /wall|portrait|door|floor|cabinet|wardrobe|table/i.test(h.object.name) || h.object.isMesh);
    if (!wallHit) return;
    const point = wallHit.point.clone();
    if (!state.face) createFace();
    state.face.visible = true;
    state.face.position.copy(point).addScaledVector(wallHit.face.normal.clone().transformDirection(wallHit.object.matrixWorld).normalize(), 0.12);
    state.face.lookAt(camera.position);
    state.face.rotation.y += Math.PI;
    state.face.rotation.z = Math.PI / 2;
    state.faceTimer = 1.8;
    state.faceCooldown = 8 + Math.random() * 10;
    toast('La luz descubre una cara en la pared.');
  }

  function shoot() {
    if (!state.gameOn || !state.player.gun || state.player.ammo <= 0) return;
    const now = performance.now();
    if (now - state.lastShot < 450) return;
    state.lastShot = now;
    state.player.ammo -= 1;
    updateUI();
    beep(220, 0.05, 0.02, 'square');

    if (state.enemy && state.enemy.alive) {
      const dir = new T.Vector3(-Math.sin(state.player.yaw), Math.sin(state.player.pitch), -Math.cos(state.player.yaw));
      const enemyPos = new T.Vector3(state.enemy.x, 1.2, state.enemy.z);
      const dist = enemyPos.distanceTo(camera.position);
      const toEnemy = enemyPos.clone().sub(camera.position).normalize();
      if (dist < 12 && dir.dot(toEnemy) > 0.82) {
        state.enemy.hp -= 1;
        state.enemy.stun = 0.8;
        if (state.enemy.hp <= 0) {
          state.enemy.alive = false;
          state.enemy.group.visible = false;
          toast('La criatura cae.');
        } else {
          toast('Disparo certero.');
        }
      }
    }
  }

  function tick(dt) {
    if (!state.gameOn) return;

    const moveX = (shiftPressed('KeyD') || shiftPressed('ArrowRight') ? 1 : 0) - (shiftPressed('KeyA') || shiftPressed('ArrowLeft') ? 1 : 0) + state.joy.x;
    const moveZ = (shiftPressed('KeyW') || shiftPressed('ArrowUp') ? 1 : 0) - (shiftPressed('KeyS') || shiftPressed('ArrowDown') ? 1 : 0) - state.joy.y;

    let dx = 0;
    let dz = 0;
    if (moveX || moveZ) {
      dx = -Math.sin(state.player.yaw) * moveZ + Math.cos(state.player.yaw) * moveX;
      dz = -Math.cos(state.player.yaw) * moveZ - Math.sin(state.player.yaw) * moveX;
      const m = Math.hypot(dx, dz);
      if (m > 0) {
        dx /= m; dz /= m;
      }
    }

    const s = (state.hold.Shift || state.running ? 4.7 : 2.6) * (state.crouching ? 0.55 : 1) * (state.hidden ? 0 : 1);
    const nx = state.player.x + dx * s * dt;
    const nz = state.player.z + dz * s * dt;
    if (canMove(nx, state.player.z)) state.player.x = nx;
    if (canMove(state.player.x, nz)) state.player.z = nz;

    state.player.food = Math.max(0, state.player.food - dt * 0.15);
    state.player.water = Math.max(0, state.player.water - dt * 0.2);
    if (state.player.food < 8 || state.player.water < 8) state.player.hp -= dt * 0.9;
    if (state.player.inf > 0) {
      state.player.inf = Math.max(0, state.player.inf - dt * 0.05);
      state.player.hp -= dt * 0.18 * state.player.inf * 0.05;
    }

    camera.position.set(state.player.x, state.crouching ? 1.12 : 1.62, state.player.z);
    camera.rotation.set(state.player.pitch, state.player.yaw, 0, 'YXZ');

    flashlightLight.visible = state.flashlight;
    flashlightLight.intensity = state.flashlight ? 42 : 0;
    flashlightLight.position.set(0, 0, 0);
    flashlightLight.target.position.set(0, 0, -1.4);
    flashlightLight.target.updateMatrixWorld();

    if (state.enemy && state.enemy.alive) {
      const enemy = state.enemy;
      const waypoint = enemy.patrol[enemy.waypoint];
      const dxToWaypoint = waypoint[0] - enemy.x;
      const dzToWaypoint = waypoint[1] - enemy.z;
      const waypointDistance = Math.hypot(dxToWaypoint, dzToWaypoint);
      if (enemy.stun <= 0) {
        if (waypointDistance < 0.12) {
          enemy.waypoint = (enemy.waypoint + 1) % enemy.patrol.length;
        } else {
          const patrolSpeed = 1.15;
          enemy.x += (dxToWaypoint / waypointDistance) * patrolSpeed * dt;
          enemy.z += (dzToWaypoint / waypointDistance) * patrolSpeed * dt;
          enemy.group.rotation.y = Math.atan2(dxToWaypoint, dzToWaypoint);
        }
      }
      enemy.stun = Math.max(0, enemy.stun - dt);
      enemy.group.position.set(enemy.x, 0, enemy.z);

      const dist = Math.hypot(state.player.x - enemy.x, state.player.z - enemy.z);
      const alarm = dist < 5.5;
      $('danger').classList.toggle('alarm', alarm);
      $('danger').style.opacity = alarm ? '1' : (dist < 1.3 && !state.hidden ? '0.8' : '0');
      if (alarm && !enemy.alarmed) {
        beep(92, 0.32, 0.045, 'sawtooth');
        toast('ALARMA: el demonio se acerca. ¡Escóndete!');
      }
      enemy.alarmed = alarm;
      if (dist < 1.3 && !state.hidden) state.player.hp -= dt * 22;
    } else {
      $('danger').classList.remove('alarm');
      $('danger').style.opacity = '0';
    }

    if (state.face) {
      state.faceTimer -= dt;
      if (state.faceTimer <= 0) state.face.visible = false;
    }

    maybeFaces();

    const prompt = $('prompt');
    const target = nearestInteractable();
    if (target) {
      const message = target.type === 'hide' ? (state.hidden ? 'SALIR DEL ARMARIO' : 'ESCONDERSE EN EL ARMARIO') :
        target.type === 'hideTable' ? (state.hidden && state.hideType === 'table' ? 'SALIR DE DEBAJO' : state.crouching ? 'ESCONDERSE BAJO LA MESA' : 'AGÁCHATE PARA ESCONDERTE') :
        target.type === 'drawer' ? (target.opened ? 'REGISTRAR CAJÓN' : 'ABRIR EL CAJÓN') :
        target.type === 'item' ? 'RECOGER · ' + target.label.toUpperCase() : 'ABRIR / USAR';
      prompt.innerHTML = '<b>E</b>' + message;
      prompt.classList.add('show');
      $('crosshair').classList.add('hot');
    } else {
      prompt.classList.remove('show');
      $('crosshair').classList.remove('hot');
    }

    if (state.player.hp <= 0) {
      finish(false);
      return;
    }

    if (performance.now() - state.uiTimer > 400) {
      updateUI();
      state.uiTimer = performance.now();
    }

    if (dx || dz) {
      if (performance.now() - state.lastFoot > 440) {
        state.lastFoot = performance.now();
        beep(70 + Math.random() * 20, 0.04, 0.012, 'triangle');
      }
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.033, clock.getDelta());
    tick(dt);
    renderer.render(scene, camera);
  }

  const clock = new T.Clock();

  document.addEventListener('keydown', (event) => {
    state.hold[event.code] = true;
    if (event.code === 'KeyF') state.flashlight = !state.flashlight;
    if (event.code === 'KeyQ') useItem();
    if (event.code === 'KeyE') {
      const target = nearestInteractable();
      interactWith(target);
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') state.running = true;
    if (event.code === 'KeyC') state.crouching = !state.crouching;
    if (event.code === 'Escape') document.exitPointerLock?.();
    if (event.code === 'KeyM') {
      state.audioEnabled = !state.audioEnabled;
      $('audioBtn').textContent = state.audioEnabled ? 'AUDIO ON' : 'AUDIO OFF';
    }
  });

  document.addEventListener('keyup', (event) => {
    state.hold[event.code] = false;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') state.running = false;
  });

  document.addEventListener('pointerlockchange', () => {
    state.pointerLocked = document.pointerLockElement === canvas;
  });

  document.addEventListener('mousemove', (event) => {
    if (!state.pointerLocked || !state.gameOn) return;
    state.player.yaw -= event.movementX * 0.0024 * state.sensitivity;
    state.player.pitch = Math.max(-1.3, Math.min(1.3, state.player.pitch - event.movementY * 0.0018 * state.sensitivity));
  });

  let touchLook = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !state.gameOn) return;
    touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (event.isTrusted && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {
        touchLook = null;
      }
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!touchLook || touchLook.id !== event.pointerId || !state.gameOn) return;
    const dx = event.clientX - touchLook.x;
    const dy = event.clientY - touchLook.y;
    touchLook.x = event.clientX;
    touchLook.y = event.clientY;
    state.player.yaw -= dx * 0.003 * state.sensitivity;
    state.player.pitch = Math.max(-1.3, Math.min(1.3, state.player.pitch - dy * 0.002 * state.sensitivity));
    event.preventDefault();
  });
  const endTouchLook = (event) => {
    if (touchLook && touchLook.id === event.pointerId) touchLook = null;
  };
  canvas.addEventListener('pointerup', endTouchLook);
  canvas.addEventListener('pointercancel', endTouchLook);

  canvas.addEventListener('click', () => {
    if (!state.gameOn) return;
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
      return;
    }
    shoot();
  });

  $('start').addEventListener('click', startGame);
  $('restart').addEventListener('click', startGame);
  $('audioBtn').addEventListener('click', () => {
    state.audioEnabled = !state.audioEnabled;
    $('audioBtn').textContent = state.audioEnabled ? 'AUDIO ON' : 'AUDIO OFF';
  });

  $('settingsBtn').addEventListener('click', () => {
    $('settingsPanel').classList.toggle('show');
  });
  $('sensitivity').addEventListener('input', (event) => {
    state.sensitivity = Number(event.target.value);
    $('sensitivityValue').textContent = state.sensitivity.toFixed(1).replace('.', ',') + '×';
  });

  const joy = $('joy');
  const runBtn = $('runBtn');
  const crouchBtn = $('crouchBtn');
  const lightBtn = $('lightBtn');
  const useBtn = $('useBtn');

  function handleJoyMove(clientX, clientY) {
    const rect = joy.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const limit = 30;
    const nx = Math.max(-1, Math.min(1, dx / limit));
    const ny = Math.max(-1, Math.min(1, dy / limit));
    state.joy.x = nx;
    state.joy.y = ny;
    joy.style.transform = 'translate(' + (dx * 0.7) + 'px,' + (dy * 0.7) + 'px)';
  }

  joy.addEventListener('touchstart', (event) => {
    state.joy.active = true;
    const touch = event.touches[0];
    handleJoyMove(touch.clientX, touch.clientY);
  }, { passive: true });
  joy.addEventListener('touchmove', (event) => {
    if (!state.joy.active) return;
    const touch = event.touches[0];
    handleJoyMove(touch.clientX, touch.clientY);
  }, { passive: true });
  joy.addEventListener('touchend', () => {
    state.joy.active = false;
    state.joy.x = 0;
    state.joy.y = 0;
    joy.style.transform = 'translate(0,0)';
  });

  runBtn.addEventListener('pointerdown', () => { state.running = true; runBtn.classList.add('active'); });
  runBtn.addEventListener('pointerup', () => { state.running = false; runBtn.classList.remove('active'); });
  runBtn.addEventListener('pointerleave', () => { state.running = false; runBtn.classList.remove('active'); });
  crouchBtn.addEventListener('pointerdown', () => { state.crouching = !state.crouching; crouchBtn.classList.toggle('active', state.crouching); });
  lightBtn.addEventListener('pointerdown', () => { state.flashlight = !state.flashlight; lightBtn.classList.toggle('active', state.flashlight); });
  useBtn.addEventListener('pointerdown', () => { const target = nearestInteractable(); interactWith(target); });

  createRoom();
  updateUI();
  animate();
})();
