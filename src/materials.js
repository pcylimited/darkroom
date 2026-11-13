// Material library. Every batched surface references one of these by name.
import * as THREE from 'three';

export function makeMaterials(tex) {
  const M = {};

  const std = (name, t, o = {}) => {
    const { cast, receive, renderOrder, tileMul, ...rest } = o;
    const m = new THREE.MeshStandardMaterial({
      map: t ? t.map : null,
      normalMap: t ? t.normalMap : null,
      roughnessMap: t ? t.ormMap : null,
      metalnessMap: t ? t.ormMap : null,
      metalness: t ? 1 : 0,
      roughness: 1,
      vertexColors: true,
      ...rest,
    });
    m.name = name;
    m.userData.tile = (t ? t.tile : 1) * (tileMul || 1);
    if (cast === false) m.userData.cast = false;
    if (receive === false) m.userData.receive = false;
    if (renderOrder) m.userData.renderOrder = renderOrder;
    M[name] = m;
    return m;
  };
  const C = (r, g, b) => new THREE.Color(r, g, b);
  const NS = (s) => new THREE.Vector2(s, s);

  // --- architecture ---------------------------------------------------------------
  std('floorWood', tex.floorWood, { normalScale: NS(0.5), roughness: 1.7 });
  std('floorWoodDark', tex.floorWood, { color: C(0.62, 0.58, 0.56), normalScale: NS(0.5), roughness: 1.7 });
  std('floorTile', tex.floorTile, { normalScale: NS(0.5), roughness: 2.0 });
  std('ceiling', tex.plaster, { color: C(0.80, 0.79, 0.76) });
  std('plasterRim', tex.plaster, { color: C(0.55, 0.50, 0.44), side: THREE.DoubleSide });
  std('wallA', tex.wallpaper, { color: C(0.50, 0.62, 0.50) }); // faded green
  std('wallB', tex.wallpaper, { color: C(0.56, 0.64, 0.74) }); // grey blue
  std('wallC', tex.wallpaper, { color: C(0.80, 0.66, 0.44) }); // ochre
  std('wallD', tex.plaster, { color: C(0.62, 0.68, 0.66) }); // damp bare plaster
  std('wallE', tex.wallpaper, { color: C(0.66, 0.36, 0.34) }); // burgundy
  std('wallF', tex.plaster, { color: C(0.74, 0.68, 0.54) }); // yellowed
  std('wainsA', tex.beadboard, { color: C(0.30, 0.34, 0.28) });
  std('wainsE', tex.beadboard, { color: C(0.30, 0.20, 0.16) });
  std('wainsF', tex.beadboard, { color: C(0.42, 0.45, 0.40) });
  std('trim', tex.paint, { color: C(0.80, 0.78, 0.72) });
  std('trimDark', tex.paint, { color: C(0.26, 0.25, 0.23) });
  std('siding', tex.siding, {});
  std('roof', tex.wood, { color: C(0.40, 0.38, 0.36), roughness: 1.6 });
  std('ground', tex.ground, {});
  std('deck', tex.floorWood, { color: C(0.55, 0.56, 0.58), roughness: 1.5 });

  // --- wood, metal, fabric --------------------------------------------------------
  std('wood', tex.wood, { roughness: 1.7, normalScale: NS(0.7) });
  std('woodLight', tex.wood, { color: C(1.9, 1.7, 1.5), roughness: 1.7, normalScale: NS(0.7) });
  std('woodRed', tex.wood, { color: C(1.6, 0.85, 0.7), roughness: 1.6, normalScale: NS(0.7) });
  std('woodRaw', tex.wood, { color: C(1.5, 1.45, 1.35), roughness: 1.8 });
  std('woodBlack', tex.wood, { color: C(0.30, 0.28, 0.28), roughness: 1.2, normalScale: NS(0.7) });
  std('door', tex.wood, { color: C(1.15, 0.95, 0.85), roughness: 1.9, normalScale: NS(0.7) });
  std('metal', tex.metal, { roughness: 1.5 });
  std('iron', tex.metal, { color: C(0.35, 0.35, 0.37), roughness: 1.6 });
  std('brass', tex.metal, { color: C(1.0, 0.7, 0.3), roughness: 1.5 });
  std('enamel', null, { color: C(0.045, 0.085, 0.07), roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide });
  std('enamelWhite', null, { color: C(0.62, 0.60, 0.54), roughness: 0.4, side: THREE.DoubleSide });
  std('fabricWhite', tex.fabric, { color: C(1.25, 1.2, 1.1) });
  std('fabricSheet', tex.fabric, { color: C(1.0, 0.97, 0.9), side: THREE.DoubleSide });
  std('fabricBlue', tex.fabric, { color: C(0.32, 0.42, 0.62) });
  std('fabricGreen', tex.fabric, { color: C(0.20, 0.34, 0.24) });
  std('fabricRed', tex.fabric, { color: C(0.55, 0.14, 0.12) });
  std('fabricDark', tex.fabric, { color: C(0.12, 0.11, 0.11) });
  std('fabricCurtain', tex.fabric, { color: C(0.62, 0.50, 0.44), side: THREE.DoubleSide });
  std('ticking', tex.ticking, { color: C(1.2, 1.15, 1.05) });
  std('rug', tex.rug, {});
  std('rugBlue', tex.rug, { color: C(0.55, 0.85, 1.3) });
  std('plain', null, { color: C(0.5, 0.5, 0.5), roughness: 0.8 });
  std('ivory', null, { color: C(0.62, 0.58, 0.47), roughness: 0.55 });
  std('ceramic', null, { color: C(0.45, 0.47, 0.5), roughness: 0.45 });
  std('black', null, { color: C(0.004, 0.004, 0.005), roughness: 1.0 });

  // --- special ---------------------------------------------------------------------
  const glass = new THREE.MeshPhysicalMaterial({
    color: C(0.55, 0.62, 0.66), roughness: 0.22, metalness: 0, transparent: true, opacity: 0.55,
    alphaMap: tex.grime, depthWrite: false, side: THREE.DoubleSide, vertexColors: true,
    envMapIntensity: 2.5,
  });
  glass.name = 'glass';
  glass.userData = { tile: 1.4, cast: false, receive: false, renderOrder: 2 };
  M.glass = glass;

  const decalDust = new THREE.MeshStandardMaterial({
    color: C(0.50, 0.48, 0.44), alphaMap: tex.blob, map: null, transparent: true, opacity: 0.85, roughness: 1,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true,
  });
  decalDust.name = 'decalDust';
  decalDust.userData = { tile: 1, cast: false, renderOrder: 1 };
  M.decalDust = decalDust;

  const decalStain = decalDust.clone();
  decalStain.color = C(0.05, 0.04, 0.03);
  decalStain.opacity = 0.9;
  decalStain.name = 'decalStain';
  decalStain.userData = { tile: 1, cast: false, renderOrder: 1 };
  M.decalStain = decalStain;

  const mirror = new THREE.MeshStandardMaterial({ color: C(0.5, 0.52, 0.5), roughness: 0.3, metalness: 1.0, vertexColors: true, envMapIntensity: 2 });
  mirror.name = 'mirror'; mirror.userData = { tile: 1 };
  M.mirror = mirror;

  const clock = new THREE.MeshStandardMaterial({ map: tex.clock, roughness: 0.5, vertexColors: true });
  clock.name = 'clock'; clock.userData = { tile: 1 };
  M.clock = clock;

  tex.paintings.forEach((p, i) => {
    const m = new THREE.MeshStandardMaterial({ map: p, roughness: 0.38, vertexColors: true });
    m.name = 'painting' + i; m.userData = { tile: 1 };
    M['painting' + i] = m;
  });

  const keys = new THREE.MeshStandardMaterial({ map: tex.keys, roughness: 0.3, vertexColors: true });
  keys.name = 'keys'; keys.userData = { tile: 1 };
  M.keys = keys;

  // Emissive strip used for daylight leaking around the exit door.
  const leak = new THREE.MeshBasicMaterial({ color: C(1.4, 1.9, 2.6), vertexColors: true });
  leak.name = 'leak'; leak.userData = { tile: 1, cast: false, receive: false };
  M.leak = leak;

  return M;
}

/** Dim synthetic environment for image based lighting: gives glossy surfaces something to reflect. */
export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.014, 0.018), side: THREE.BackSide }),
  );
  scene.add(box);
  const add = (w, h, x, y, z, ry, color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry;
    scene.add(m);
  };
  add(2.0, 2.4, -4.9, 0.4, 0.5, Math.PI / 2, new THREE.Color(0.30, 0.42, 0.62)); // cold window
  add(1.2, 2.0, 2.0, 0.4, -4.9, 0, new THREE.Color(0.16, 0.22, 0.34));
  add(0.6, 0.6, 1.5, 2.6, 1.0, 0, new THREE.Color(1.2, 0.72, 0.30)); // warm lamp
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.016, 0.012) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2.9;
  scene.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.06);
  pmrem.dispose();
  scene.traverse((o) => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
  return rt.texture;
}
