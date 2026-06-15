import assert from "node:assert/strict";
import {
  applyTitleMusicControl,
  closeTitleMusic,
  createTitleMusicState,
  openTitleMusic,
  titleMusicControlAt,
  titleMusicHoverKey,
  titleMusicItemRect,
  titleMusicPageCount,
  titleMusicSetPage,
  titleMusicStepPage,
  titleMusicTracks,
  titleMusicVisibleChoices,
  TITLE_MUSIC_ITEM_X,
  TITLE_MUSIC_ITEM_Y,
  TITLE_MUSIC_PAGE_SIZE,
  TITLE_MUSIC_ROW_HEIGHT,
} from "../web/title-music.js";

const tracks = titleMusicTracks();
assert.equal(tracks.length, 42);
assert.equal(titleMusicPageCount(), 5);
assert.equal(tracks[0].assetName, "bgm001");
assert.equal(tracks[9].assetName, "bgm014");
assert.equal(tracks[40].assetName, "bgm033");
assert.equal(tracks[41].assetName, "bgm041");

assert.deepEqual(titleMusicItemRect(0), {
  x: TITLE_MUSIC_ITEM_X,
  y: TITLE_MUSIC_ITEM_Y,
  width: 288,
  height: 42,
});
assert.deepEqual(titleMusicItemRect(TITLE_MUSIC_PAGE_SIZE + 1), {
  x: TITLE_MUSIC_ITEM_X,
  y: TITLE_MUSIC_ITEM_Y + TITLE_MUSIC_ROW_HEIGHT,
  width: 288,
  height: 42,
});

const state = createTitleMusicState();
assert.equal(titleMusicControlAt(TITLE_MUSIC_ITEM_X, TITLE_MUSIC_ITEM_Y, state), null);
openTitleMusic(state);
assert.equal(state.open, true);
assert.equal(titleMusicVisibleChoices(state).length, 10);

const first = titleMusicControlAt(TITLE_MUSIC_ITEM_X + 1, TITLE_MUSIC_ITEM_Y + 1, state);
assert.equal(first.kind, "track");
assert.equal(first.choice.assetName, "bgm001");
assert.equal(titleMusicHoverKey(first), 0);

const selected = applyTitleMusicControl(state, first);
assert.deepEqual(selected, {
  handled: true,
  action: "select",
  index: 0,
  assetName: "bgm001",
});
assert.equal(state.selectedIndex, 0);
assert.equal(state.selectedAssetName, "bgm001");

assert.equal(titleMusicSetPage(state, 4), true);
assert.equal(state.page, 4);
assert.equal(titleMusicVisibleChoices(state).length, 2);
assert.equal(titleMusicStepPage(state, 1), false);
assert.equal(state.page, 4);
assert.equal(titleMusicStepPage(state, -1), true);
assert.equal(state.page, 3);

const back = titleMusicControlAt(981, 611, state, {
  back: { stateWidth: 96, stateHeight: 32 },
});
assert.equal(back.kind, "back");
assert.equal(titleMusicHoverKey(back), -2);
assert.deepEqual(applyTitleMusicControl(state, back), { handled: true, action: "back" });
assert.equal(state.open, false);
assert.equal(closeTitleMusic(state), false);

console.log("title_music=ok");
