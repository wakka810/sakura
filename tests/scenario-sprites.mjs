import {
  beginScenarioSpriteTransition,
  createScenarioSpriteState,
  finishScenarioSpriteTransitions,
  removeScenarioSpriteLayer,
  restoreScenarioSpriteTransition,
  setScenarioSpriteProgress,
  snapshotScenarioSpritePresentation,
  snapshotScenarioSprites,
  snapshotScenarioSpriteTransitions,
  updateScenarioSpriteLayer,
} from "../web/scenario-sprites.js";
import {
  beginScenarioSpriteControlMotion,
  stopScenarioSpriteControlMotion,
} from "../web/scenario-sprite-motion.js";
import { paintScenarioScene } from "../web/session-player.js";
import {
  beginScenarioBackgroundObjectRemoval,
  fadeScenarioSceneObject,
  finishScenarioSceneObjectTransitions,
  moveScenarioSceneObject,
  paintScenarioSceneObjects,
  removeScenarioSceneObject,
  restoreScenarioSceneObjectTransition,
  scenarioSceneObjectFrameIndex,
  setScenarioSceneObject,
  snapshotScenarioSceneObjects,
  startScenarioSceneObjectDirectionalMotion,
  stopScenarioSceneObjectMotion,
  stopScenarioSceneObjectTransitions,
} from "../web/scenario-scene-objects.js";
import {
  beginScenarioAperture,
  clearScenarioAperture,
  configureScenarioAperture,
  configureScenarioApertureBand,
  createScenarioApertureState,
  finishScenarioApertureTransition,
  paintScenarioAperture,
  restoreScenarioAperture,
  setScenarioApertureProgress,
  snapshotScenarioAperture,
} from "../web/scenario-aperture.js";
import { createScenarioFilterState } from "../web/scenario-filter.js";
import { createScenarioMovieState } from "../web/scenario-movies.js";
import {
  createScenarioRainState,
  hasActiveScenarioRain,
  paintScenarioRain,
  restoreScenarioRain,
  setScenarioRainActive,
  setScenarioRainColor,
  setScenarioRainDensity,
  setScenarioRainFade,
  setScenarioRainMotion,
  snapshotScenarioRain,
} from "../web/scenario-rain.js";
import { mappedTransitionAlpha } from "../web/scenario-transition-mask.js";

const image = { width: 1280, height: 720, pixels: new Uint8Array(4) };
const replacementImage = { width: 1280, height: 720, pixels: new Uint8Array(4) };
const mapImage = { width: 1280, height: 720, pixels: new Uint8Array(4) };
const state = createScenarioSpriteState();

const apertureState = createScenarioApertureState();
const apertureTarget = configureScenarioAperture(
  apertureState,
  [1, 300, 1, 360, 640, 120, 1280],
);
beginScenarioAperture(apertureState, apertureTarget, 300);
setScenarioApertureProgress(apertureState, 0.5);
const apertureCalls = [];
paintScenarioAperture(
  {
    save() {},
    restore() {},
    set fillStyle(value) { this.lastFillStyle = value; },
    get fillStyle() { return this.lastFillStyle; },
    fillRect: (...args) => apertureCalls.push(args),
    createLinearGradient() {
      return { addColorStop() {} };
    },
  },
  { width: 1280, height: 720 },
  apertureState,
);
if (apertureCalls.length < 2) {
  throw new Error(`aperture mask did not paint ${JSON.stringify(apertureCalls)}`);
}
finishScenarioApertureTransition(apertureState);
const apertureSnapshot = snapshotScenarioAperture(apertureState);
if (
  apertureSnapshot?.centerX !== 640
  || apertureSnapshot?.centerY !== 360
  || apertureSnapshot?.width !== 1280
  || apertureSnapshot?.height !== 120
) {
  throw new Error(`aperture snapshot drifted ${JSON.stringify(apertureSnapshot)}`);
}
clearScenarioAperture(apertureState, 0);
if (snapshotScenarioAperture(apertureState) !== null) {
  throw new Error("aperture clear left an active mask");
}
restoreScenarioAperture(apertureState, apertureSnapshot);
if (snapshotScenarioAperture(apertureState)?.height !== 120) {
  throw new Error("aperture restore failed");
}
restoreScenarioAperture(apertureState, null);
if (snapshotScenarioAperture(apertureState) !== null) {
  throw new Error("aperture restore from null snapshot left active mask");
}
clearScenarioAperture(apertureState, 0);

const bandApertureState = createScenarioApertureState();
const bandTarget = configureScenarioApertureBand(bandApertureState, [1, 1, 1, 224]);
beginScenarioAperture(bandApertureState, bandTarget, 0);
const bandSnapshot = snapshotScenarioAperture(bandApertureState);
if (
  bandSnapshot?.centerX !== 640
  || bandSnapshot?.centerY !== 360
  || bandSnapshot?.width !== 1280
  || bandSnapshot?.height !== 224
) {
  throw new Error(`band aperture snapshot drifted ${JSON.stringify(bandSnapshot)}`);
}
const closedBand = configureScenarioApertureBand(bandApertureState, [1, 2000, 1, 0]);
beginScenarioAperture(bandApertureState, closedBand, 0);
if (snapshotScenarioAperture(bandApertureState)?.height !== 0) {
  throw new Error("closed band aperture did not preserve height 0");
}
clearScenarioAperture(bandApertureState, 0);

const rainState = createScenarioRainState();
setScenarioRainColor(rainState, [230, 240, 245, 255]);
setScenarioRainMotion(rainState, [5, 0, 90]);
setScenarioRainFade(rainState, [500]);
setScenarioRainDensity(rainState, [10]);
setScenarioRainActive(rainState, [0, 0, 1], 1000);
if (!hasActiveScenarioRain(rainState)) {
  throw new Error("rain did not activate");
}
const rainCalls = { moveTo: 0, lineTo: 0, stroke: 0 };
paintScenarioRain(
  {
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() { rainCalls.moveTo += 1; },
    lineTo() { rainCalls.lineTo += 1; },
    stroke() { rainCalls.stroke += 1; },
    set strokeStyle(value) { this.lastStrokeStyle = value; },
    get strokeStyle() { return this.lastStrokeStyle; },
    set lineWidth(value) { this.lastLineWidth = value; },
    get lineWidth() { return this.lastLineWidth; },
  },
  { width: 1280, height: 720 },
  rainState,
  1250,
);
if (rainCalls.moveTo === 0 || rainCalls.moveTo !== rainCalls.lineTo || rainCalls.stroke !== 1) {
  throw new Error(`rain did not paint strokes ${JSON.stringify(rainCalls)}`);
}
const rainSnapshot = snapshotScenarioRain(rainState);
if (
  rainSnapshot?.density !== 10
  || rainSnapshot?.speed !== 5
  || rainSnapshot?.angleDeg !== 90
  || rainSnapshot?.fadeMs !== 500
) {
  throw new Error(`rain snapshot drifted ${JSON.stringify(rainSnapshot)}`);
}
setScenarioRainActive(rainState, [0, 0, 0], 1300);
if (snapshotScenarioRain(rainState) !== null) {
  throw new Error("rain stop left an active snapshot");
}
restoreScenarioRain(rainState, rainSnapshot, 1400);
if (!hasActiveScenarioRain(rainState) || snapshotScenarioRain(rainState)?.density !== 10) {
  throw new Error("rain restore failed");
}
restoreScenarioRain(rainState, null, 1450);
if (hasActiveScenarioRain(rainState) || snapshotScenarioRain(rainState) !== null) {
  throw new Error("rain restore from null snapshot left active state");
}
setScenarioRainActive(rainState, [0, 0, 0], 1500);

const sceneObjectCanvas = { tag: "scene-object-source" };
const sceneObjectImage = { width: 1280, height: 720, canvas: sceneObjectCanvas };
for (const placement of [
  { label: "center anchor", x: 0, y: 0, anchorX: 640, anchorY: 360 },
  { label: "explicit top-left", x: -640, y: -360, anchorX: 0, anchorY: 0 },
]) {
  const drawState = createScenarioSpriteState();
  setScenarioSceneObject(drawState, 9, sceneObjectImage, {
    assetName: placement.label,
    ...placement,
  });
  const drawCalls = [];
  paintScenarioSceneObjects(
    {
      save() {},
      restore() {},
      drawImage: (...args) => drawCalls.push(args),
    },
    { width: 1280, height: 720 },
    drawState,
    1000,
  );
  const [, , , , , dx, dy, dw, dh] = drawCalls[0] ?? [];
  if (
    drawCalls.length !== 1
    || dx !== 0
    || dy !== 0
    || dw !== 1280
    || dh !== 720
  ) {
    throw new Error(
      `scene object ${placement.label} placement drifted ${JSON.stringify(drawCalls)}`,
    );
  }
}

const priorityState = createScenarioSpriteState();
const priorityDrawOrder = [];
setScenarioSceneObject(priorityState, 0, { ...sceneObjectImage, canvas: { tag: "background" } }, {
  assetName: "sp0044a_bg",
  x: -640,
  y: -360,
  priority: 0,
});
setScenarioSceneObject(priorityState, 1, { ...sceneObjectImage, canvas: { tag: "foreground" } }, {
  assetName: "sp0044a_maku",
  x: -640,
  y: -360,
  z: -389,
  priority: 30,
});
paintScenarioSceneObjects(
  {
    save() {},
    restore() {},
    drawImage: (source) => priorityDrawOrder.push(source.tag),
  },
  { width: 1280, height: 720 },
  priorityState,
  1000,
);
if (priorityDrawOrder.join(",") !== "background,foreground") {
  throw new Error(`scene object priority draw order drifted ${JSON.stringify(priorityDrawOrder)}`);
}

const realDocumentForCompositor = globalThis.document;
globalThis.document = {
  createElement() {
    return {
      height: 0,
      width: 0,
      getContext() {
        return {
          putImageData() {},
        };
      },
    };
  },
};
const compositorState = createScenarioSpriteState();
setScenarioSceneObject(compositorState, 30, sceneObjectImage, {
  assetName: "ED01_staff_makoto",
  x: -640,
  y: -360,
  alpha: 1,
});
const compositorDrawCalls = [];
paintScenarioScene(
  {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    drawImage: (...args) => compositorDrawCalls.push(args),
  },
  { width: 1280, height: 720 },
  {
    scene: {
      aperture: createScenarioApertureState(),
      current: null,
      currentName: null,
      filter: createScenarioFilterState(),
      movies: createScenarioMovieState(null),
      progress: 1,
      rain: createScenarioRainState(),
      sprites: compositorState,
      target: null,
      targetName: null,
      transitionMap: null,
      transitionMapName: null,
      transitioning: false,
    },
  },
);
globalThis.document = realDocumentForCompositor;
if (compositorDrawCalls.length !== 1) {
  throw new Error(
    `paintScenarioScene did not composite scene objects ${JSON.stringify(compositorDrawCalls)}`,
  );
}

const motionDrawState = createScenarioSpriteState();
setScenarioSceneObject(motionDrawState, 5, sceneObjectImage, {
  assetName: "sp0044b_ani_l",
  x: -640,
  y: -360,
});
if (!startScenarioSceneObjectDirectionalMotion(
  motionDrawState,
  5,
  [0, 0, 0, 0, 8, 128, 5],
  1000,
)) {
  throw new Error("scene object directional motion was not accepted");
}
const motionDrawCalls = [];
paintScenarioSceneObjects(
  {
    save() {},
    restore() {},
    drawImage: (...args) => motionDrawCalls.push(args),
  },
  { width: 1280, height: 720 },
  motionDrawState,
  1008,
);
const motionSnapshot = snapshotScenarioSceneObjects(motionDrawState, 1008)[0];
const [, , , , , motionDx, motionDy] = motionDrawCalls[0] ?? [];
if (
  motionDrawCalls.length !== 1
  || motionDx <= 0
  || motionDy !== 0
  || motionSnapshot.x !== -640
  || motionSnapshot.y !== -360
  || motionSnapshot.motion?.directionMode !== 0
  || motionSnapshot.motion?.speed !== 128
) {
  throw new Error(
    `scene object directional motion drifted ${JSON.stringify({ motionDrawCalls, motionSnapshot })}`,
  );
}
if (!stopScenarioSceneObjectMotion(motionDrawState, 5)) {
  throw new Error("scene object directional motion was not stopped");
}
const stoppedMotionSnapshot = snapshotScenarioSceneObjects(motionDrawState, 1010)[0];
if (stoppedMotionSnapshot.motion !== null) {
  throw new Error(`scene object motion stop left snapshot state ${JSON.stringify(stoppedMotionSnapshot)}`);
}

const removalState = createScenarioSpriteState();
setScenarioSceneObject(removalState, 12, sceneObjectImage, {
  assetName: "ev0013b_l",
  x: -477,
  y: 575,
  z: 259,
  priority: 10,
});
moveScenarioSceneObject(
  removalState,
  12,
  { x: 0, y: 0, z: 1280, alpha: 1 },
  6000,
  { now: 1000 },
);
startScenarioSceneObjectDirectionalMotion(
  removalState,
  12,
  [0, 0, 0, 0, 8, 128, 5],
  1000,
);
beginScenarioBackgroundObjectRemoval(removalState, 1000);
if (!removeScenarioSceneObject(removalState, 12)) {
  throw new Error("scene object removal rejected an active object");
}
if (
  removalState.sceneObjects.has(12)
  || removalState.sceneObjectTransitions.has(12)
  || removalState.sceneObjectMotions.has(12)
  || removalState.sceneObjectBackgroundTransition?.ids.has(12)
) {
  throw new Error("scene object removal left dependent state behind");
}
if (removeScenarioSceneObject(removalState, 12)) {
  throw new Error("scene object removal reported a second removal");
}

const realDocument = globalThis.document;
globalThis.document = {
  createElement() {
    return {
      height: 0,
      width: 0,
      getContext() {
        return {
          clearRect() {},
          createImageData: (width, height) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          drawImage() {},
          putImageData() {},
        };
      },
    };
  },
};
const maskedDrawState = createScenarioSpriteState();
const sceneObjectMaskImage = {
  width: 2,
  height: 1,
  pixels: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
};
setScenarioSceneObject(maskedDrawState, 10, sceneObjectImage, {
  assetName: "data02504.arc",
  isMovie: true,
  maskAssetName: "LR_Grad_mask",
  maskImage: sceneObjectMaskImage,
  x: -640,
  y: -360,
});
const maskedDrawCalls = [];
paintScenarioSceneObjects(
  {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save() {},
    restore() {},
    drawImage: (...args) => maskedDrawCalls.push(args),
  },
  { width: 1280, height: 720 },
  maskedDrawState,
  1000,
);
const maskedSnapshot = snapshotScenarioSceneObjects(maskedDrawState)[0];
const [, dx, dy, dw, dh] = maskedDrawCalls[0] ?? [];
if (
  maskedDrawCalls.length !== 1
  || maskedSnapshot.maskAssetName !== "LR_Grad_mask"
  || dx !== 0
  || dy !== 0
  || dw !== 1280
  || dh !== 720
) {
  throw new Error(
    `masked scene object draw drifted ${JSON.stringify({ maskedDrawCalls, maskedSnapshot })}`,
  );
}
globalThis.document = realDocument;

setScenarioSceneObject(state, 0, image, {
  assetName: "sp0006a",
  x: -640,
  y: -360,
  z: 0,
  priority: 20,
  animation: {
    frameCount: 2,
    frameIntervalMs: 250,
    sequenceStyle: 1,
    elapsedMs: 125,
  },
});
setScenarioSceneObject(state, 1, image, {
  assetName: "ev0001a",
  x: -1000,
  y: -820,
  z: 100,
});

const animated = state.sceneObjects.get(0);
const animationStart = animated.animation.startedAt;
if (
  scenarioSceneObjectFrameIndex(animated, animationStart + 249) !== 0
  || scenarioSceneObjectFrameIndex(animated, animationStart + 250) !== 1
  || scenarioSceneObjectFrameIndex(animated, animationStart + 500) !== 0
) {
  throw new Error("scene object animation did not loop across horizontal frames");
}

if (!moveScenarioSceneObject(
  state,
  1,
  { x: -1100, y: -820, z: 100, alpha: 0.5 },
  6000,
  { now: 1000 },
)) {
  throw new Error("scene object move was not accepted");
}
if (!fadeScenarioSceneObject(state, 0, 3000, { now: 1000 })) {
  throw new Error("scene object fade was not accepted");
}
const concurrent = snapshotScenarioSceneObjects(state, 2500);
const fading = concurrent.find((object) => object.id === 0);
const moving = concurrent.find((object) => object.id === 1);
if (
  fading?.alpha !== 0.5
  || fading.transition?.type !== "fade"
  || moving?.x !== -1025
  || moving.alpha !== 0.875
  || moving.transition?.remainingMs !== 4500
) {
  throw new Error(`scene object transitions did not run concurrently ${JSON.stringify(concurrent)}`);
}

finishScenarioSceneObjectTransitions(state, 4000);
const oneCompleted = snapshotScenarioSceneObjects(state, 4000);
if (
  oneCompleted.length !== 1
  || oneCompleted[0].id !== 1
  || oneCompleted[0].x !== -1050
  || oneCompleted[0].transition?.remainingMs !== 3000
) {
  throw new Error(`completed fade disturbed active move ${JSON.stringify(oneCompleted)}`);
}

const restoredState = createScenarioSpriteState();
setScenarioSceneObject(restoredState, 1, image, oneCompleted[0]);
if (!restoreScenarioSceneObjectTransition(
  restoredState,
  1,
  oneCompleted[0].transition,
  10_000,
)) {
  throw new Error("scene object transition restore was rejected");
}
const restoredMidpoint = snapshotScenarioSceneObjects(restoredState, 11_500)[0];
if (
  restoredMidpoint.x !== -1075
  || restoredMidpoint.alpha !== 0.625
  || restoredMidpoint.transition?.remainingMs !== 1500
) {
  throw new Error(`scene object transition restored wrong phase ${JSON.stringify(restoredMidpoint)}`);
}

const stopTransitionState = createScenarioSpriteState();
setScenarioSceneObject(stopTransitionState, 0, image, {
  assetName: "ED05_BG",
  x: 0,
  y: 0,
  z: 0,
});
setScenarioSceneObject(stopTransitionState, 30, image, {
  assetName: "ED05_staff_past",
  x: -640,
  y: -360,
  z: 900,
});
moveScenarioSceneObject(
  stopTransitionState,
  0,
  { x: 100, y: 50, z: 0, alpha: 1 },
  2000,
  { now: 1000 },
);
moveScenarioSceneObject(
  stopTransitionState,
  30,
  { x: -640, y: -720, z: 900, alpha: 1 },
  4000,
  { now: 1000 },
);
const stoppedTransitionCount = stopScenarioSceneObjectTransitions(stopTransitionState, 2000);
const stoppedTransitions = snapshotScenarioSceneObjects(stopTransitionState, 2000);
const stoppedBg = stoppedTransitions.find((object) => object.id === 0);
const stoppedStaff = stoppedTransitions.find((object) => object.id === 30);
if (
  stoppedTransitionCount !== 2
  || stopTransitionState.sceneObjectTransitions.size !== 0
  || stoppedBg?.x !== 50
  || stoppedBg?.y !== 25
  || stoppedStaff?.y !== -450
  || stoppedBg.transition !== null
  || stoppedStaff.transition !== null
) {
  throw new Error(`scene object transition stop drifted ${JSON.stringify(stoppedTransitions)}`);
}

finishScenarioSceneObjectTransitions(state, 7000);
const moved = snapshotScenarioSceneObjects(state, 7000)[0];
if (
  moved.x !== -1100
  || moved.y !== -820
  || moved.z !== 100
  || moved.alpha !== 0.5
  || moved.transition !== null
) {
  throw new Error(`scene object move did not commit its target ${JSON.stringify(moved)}`);
}

setScenarioSceneObject(state, 3, image, { assetName: "blocking" });
moveScenarioSceneObject(
  state,
  3,
  { x: 50, y: 60, z: 70, alpha: 0.25 },
  6000,
  { blocking: true, now: 8000 },
);
finishScenarioSceneObjectTransitions(state, 8001);
const blocked = snapshotScenarioSceneObjects(state, 8001).find((object) => object.id === 3);
if (
  blocked.x !== 50
  || blocked.y !== 60
  || blocked.z !== 70
  || blocked.alpha !== 0.25
) {
  throw new Error(`blocking transition did not finish on input ${JSON.stringify(blocked)}`);
}

setScenarioSceneObject(state, 2, image, {
  assetName: "clickwait",
  priority: 255,
});
beginScenarioBackgroundObjectRemoval(state, 1000);
setScenarioSpriteProgress(state, 1);
finishScenarioSpriteTransitions(state);
const backgroundSurvivors = snapshotScenarioSceneObjects(state);
if (
  backgroundSurvivors.length !== 1
  || backgroundSurvivors[0].id !== 2
  || backgroundSurvivors[0].priority !== 255
) {
  throw new Error(`background transition removed wrong priorities ${JSON.stringify(backgroundSurvivors)}`);
}

const maskedRemovalState = createScenarioSpriteState();
setScenarioSceneObject(maskedRemovalState, 4, image, {
  assetName: "masked_removal",
  alpha: 0.8,
  priority: 20,
});
beginScenarioBackgroundObjectRemoval(
  maskedRemovalState,
  1000,
  { fade: false },
);
setScenarioSpriteProgress(maskedRemovalState, 0.5);
const maskedRemovalObject = snapshotScenarioSceneObjects(maskedRemovalState)[0];
if (maskedRemovalObject.alpha !== 0.8) {
  throw new Error(
    `mapped background removal applied a second alpha fade ${JSON.stringify(maskedRemovalObject)}`,
  );
}
finishScenarioSpriteTransitions(maskedRemovalState);
if (snapshotScenarioSceneObjects(maskedRemovalState).length !== 0) {
  throw new Error("mapped background removal did not clear the object on completion");
}

const motionState = createScenarioSpriteState();
beginScenarioSpriteTransition(motionState, 7, image, 0, {
  assetName: "wt0000aa",
  x: 0,
  y: 800,
  z: 0,
});
const motionBytes = new Uint8Array(0x240);
const motionView = new DataView(motionBytes.buffer);
motionView.setInt32(0, 1, true);
motionView.setInt32(0x10, 256, true);
motionView.setInt32(0x1c, 0, true);
motionView.setInt32(0x24, 800, true);
motionView.setInt32(0x2c, 200, true);
motionView.setInt32(0x120, 2, true);
motionView.setInt32(0x130, 0, true);
motionView.setInt32(0x13c, 1000, true);
motionView.setInt32(0x140, 0, true);
motionView.setInt32(0x144, 800, true);
motionView.setInt32(0x150, 50, true);
motionView.setInt32(0x154, 0, true);

if (!beginScenarioSpriteControlMotion(motionState, 39, 1, motionBytes, 100)) {
  throw new Error("sprite control motion was not accepted");
}
const midpoint = snapshotScenarioSpritePresentation(motionState, 1050)[0];
if (
  midpoint.x !== 25
  || midpoint.y !== 400
  || midpoint.alpha !== 0.75
) {
  throw new Error(`sprite control motion interpolated wrong midpoint ${JSON.stringify(midpoint)}`);
}
if (!stopScenarioSpriteControlMotion(motionState, 39, 1300)) {
  throw new Error("sprite control motion was not stopped");
}
const controlled = snapshotScenarioSprites(motionState)[0];
if (
  controlled.slot !== 7
  || controlled.x !== 50
  || controlled.y !== 0
  || controlled.alpha !== 1
) {
  throw new Error(`sprite control motion committed wrong target ${JSON.stringify(controlled)}`);
}

const updateState = createScenarioSpriteState();
beginScenarioSpriteTransition(updateState, 7, image, 0, {
  assetName: "wt0019aa_bs",
  x: 0,
  y: -1500,
  z: 0,
});
if (!updateScenarioSpriteLayer(updateState, 7, 1000, {
  alpha: 1 - 180 / 256,
  now: 100,
  x: 0,
  y: 450,
  z: 0,
})) {
  throw new Error("sprite update was not accepted");
}
const updatedMidpoint = snapshotScenarioSpritePresentation(updateState, 600)[0];
if (
  updatedMidpoint.x !== 0
  || updatedMidpoint.y !== -525
  || updatedMidpoint.z !== 0
  || updatedMidpoint.alpha !== 0.6484375
) {
  throw new Error(`sprite update interpolated wrong midpoint ${JSON.stringify(updatedMidpoint)}`);
}
finishScenarioSpriteTransitions(updateState, 1100);
const updated = snapshotScenarioSprites(updateState)[0];
if (updated.y !== 450 || updated.alpha !== 0.296875) {
  throw new Error(`sprite update committed wrong target ${JSON.stringify(updated)}`);
}

if (!updateScenarioSpriteLayer(updateState, 7, 300, {
  image: replacementImage,
  assetName: "wt0000aa",
  now: 1200,
})) {
  throw new Error("sprite replacement was not accepted");
}
finishScenarioSpriteTransitions(updateState, 1500);
const replaced = snapshotScenarioSprites(updateState)[0];
if (replaced.assetName !== "wt0000aa" || replaced.y !== 450 || replaced.alpha !== 0.296875) {
  throw new Error(`sprite replacement did not preserve state ${JSON.stringify(replaced)}`);
}

if (!removeScenarioSpriteLayer(updateState, 7, 500, {
  alpha: 0,
  now: 2000,
  x: -25,
  y: 450,
  z: 0,
})) {
  throw new Error("sprite removal was not accepted");
}
const removing = snapshotScenarioSpritePresentation(updateState, 2250)[0];
if (removing.x !== -12.5 || removing.alpha !== 0.1484375) {
  throw new Error(`sprite removal interpolated wrong midpoint ${JSON.stringify(removing)}`);
}
finishScenarioSpriteTransitions(updateState, 2500);
if (snapshotScenarioSprites(updateState).length !== 0) {
  throw new Error("sprite removal did not delete its target");
}

const concurrentSpriteState = createScenarioSpriteState();
beginScenarioSpriteTransition(concurrentSpriteState, 1, image, 1000, {
  assetName: "left",
  eventCount: 10,
  mapAssetName: "map001",
  mapImage,
  now: 100,
  opcode: 0x02c0,
  x: -300,
});
beginScenarioSpriteTransition(concurrentSpriteState, 6, replacementImage, 500, {
  assetName: "right",
  eventCount: 11,
  now: 100,
  opcode: 0x02c0,
  x: 300,
});
const concurrentSprites = snapshotScenarioSpritePresentation(concurrentSpriteState, 350);
if (
  concurrentSprites.length !== 2
  || concurrentSprites.find((layer) => layer.slot === 1)?.alpha !== 0.25
  || concurrentSprites.find((layer) => layer.slot === 6)?.alpha !== 0.5
) {
  throw new Error(`sprite transitions did not run concurrently ${JSON.stringify(concurrentSprites)}`);
}
const spriteTransitionSnapshots = snapshotScenarioSpriteTransitions(
  concurrentSpriteState,
  350,
);
if (
  spriteTransitionSnapshots.length !== 2
  || spriteTransitionSnapshots[0].remainingMs !== 750
  || spriteTransitionSnapshots[1].remainingMs !== 250
  || spriteTransitionSnapshots[0].mapAssetName !== "map001"
) {
  throw new Error(`sprite transitions snapshot was wrong ${JSON.stringify(spriteTransitionSnapshots)}`);
}

const restoredSpriteState = createScenarioSpriteState();
if (!restoreScenarioSpriteTransition(
  restoredSpriteState,
  spriteTransitionSnapshots[0],
  { mapImage, now: 1000, toImage: image },
)) {
  throw new Error("sprite transition restore was rejected");
}
const restoredSprite = snapshotScenarioSpritePresentation(restoredSpriteState, 1375)[0];
if (restoredSprite.x !== -300 || restoredSprite.alpha !== 0.5) {
  throw new Error(`sprite transition restored wrong phase ${JSON.stringify(restoredSprite)}`);
}

const orderedRestoreState = createScenarioSpriteState();
beginScenarioSpriteTransition(orderedRestoreState, 2, image, 0, {
  assetName: "ordered_a",
  order: 42,
});
beginScenarioSpriteTransition(orderedRestoreState, 3, image, 0, {
  assetName: "ordered_b",
});
const orderedSprites = snapshotScenarioSprites(orderedRestoreState);
if (
  orderedSprites[0].order !== 42
  || orderedSprites[1].order !== 43
) {
  throw new Error(`sprite restore order was not preserved ${JSON.stringify(orderedSprites)}`);
}

if (
  mappedTransitionAlpha(16, 0) !== 0
  || mappedTransitionAlpha(16, 1) !== 255
  || mappedTransitionAlpha(16, 0.25) <= mappedTransitionAlpha(240, 0.25)
  || mappedTransitionAlpha(128, 0.25) >= mappedTransitionAlpha(128, 0.75)
) {
  throw new Error("mapped transition did not reveal darker map values first");
}

finishScenarioSpriteTransitions(concurrentSpriteState, 600);
if (
  concurrentSpriteState.transitions.size !== 1
  || concurrentSpriteState.layers.get(6)?.assetName !== "right"
) {
  throw new Error("completed sprite transition disturbed another slot");
}

console.log("scenario_sprites=ok");
