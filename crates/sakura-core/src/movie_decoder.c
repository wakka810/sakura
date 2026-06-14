#include <stddef.h>
#include <stdint.h>

void *sakura_movie_malloc(size_t len);
void *sakura_movie_realloc(void *ptr, size_t len);
void sakura_movie_free(void *ptr);

static int sakura_movie_abs(int value) {
	return value < 0 ? -value : value;
}

#define PLM_MALLOC(sz) sakura_movie_malloc(sz)
#define PLM_REALLOC(ptr, sz) sakura_movie_realloc((ptr), (sz))
#define PLM_FREE(ptr) sakura_movie_free(ptr)
#define abs(value) sakura_movie_abs(value)
#define PLM_NO_STDIO
#define PL_MPEG_IMPLEMENTATION
#include "pl_mpeg.h"

typedef struct {
	plm_video_t *video;
} sakura_movie_decoder_t;

static const uint8_t SAKURA_MOVIE_END_SENTINEL[8] = {
	0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00
};

sakura_movie_decoder_t *sakura_plm_create(const uint8_t *bytes, size_t len) {
	if (bytes == NULL || len == 0) {
		return NULL;
	}
	if (len > SIZE_MAX - sizeof(SAKURA_MOVIE_END_SENTINEL)) {
		return NULL;
	}

	plm_buffer_t *buffer = plm_buffer_create_with_capacity(
		len + sizeof(SAKURA_MOVIE_END_SENTINEL)
	);
	if (buffer == NULL) {
		return NULL;
	}
	if (
		plm_buffer_write(buffer, (uint8_t *)bytes, len) != len ||
		plm_buffer_write(
			buffer,
			(uint8_t *)SAKURA_MOVIE_END_SENTINEL,
			sizeof(SAKURA_MOVIE_END_SENTINEL)
		) != sizeof(SAKURA_MOVIE_END_SENTINEL)
	) {
		plm_buffer_destroy(buffer);
		return NULL;
	}

	plm_video_t *video = plm_video_create_with_buffer(buffer, TRUE);
	if (
		video == NULL ||
		plm_video_get_width(video) <= 0 ||
		plm_video_get_height(video) <= 0 ||
		plm_video_get_framerate(video) <= 0
	) {
		if (video != NULL) {
			plm_video_destroy(video);
		}
		else {
			plm_buffer_destroy(buffer);
		}
		return NULL;
	}

	sakura_movie_decoder_t *decoder =
		(sakura_movie_decoder_t *)sakura_movie_malloc(sizeof(*decoder));
	if (decoder == NULL) {
		plm_video_destroy(video);
		return NULL;
	}
	decoder->video = video;
	return decoder;
}

void sakura_plm_destroy(sakura_movie_decoder_t *decoder) {
	if (decoder == NULL) {
		return;
	}
	plm_video_destroy(decoder->video);
	sakura_movie_free(decoder);
}

unsigned int sakura_plm_width(const sakura_movie_decoder_t *decoder) {
	return decoder == NULL ? 0 : (unsigned int)plm_video_get_width(decoder->video);
}

unsigned int sakura_plm_height(const sakura_movie_decoder_t *decoder) {
	return decoder == NULL ? 0 : (unsigned int)plm_video_get_height(decoder->video);
}

double sakura_plm_framerate(const sakura_movie_decoder_t *decoder) {
	return decoder == NULL ? 0.0 : plm_video_get_framerate(decoder->video);
}

plm_frame_t *sakura_plm_decode(sakura_movie_decoder_t *decoder) {
	if (decoder == NULL) {
		return NULL;
	}
	plm_frame_t *frame = plm_video_decode(decoder->video);
	if (frame != NULL) {
		return frame;
	}

	/*
	 * A complete raw stream may end in a B picture. pl_mpeg's normal
	 * end-of-stream branch checks the last picture type and therefore
	 * omits the final queued I/P reference in that legal layout.
	 * The decoder always receives the whole stream plus a private sentinel,
	 * so NULL here is definitive EOF and the queued reference is safe.
	 */
	if (decoder->video->has_reference_frame) {
		decoder->video->has_reference_frame = FALSE;
		frame = &decoder->video->frame_backward;
		frame->time = decoder->video->time;
		decoder->video->frames_decoded++;
		decoder->video->time =
			(double)decoder->video->frames_decoded / decoder->video->framerate;
		return frame;
	}
	return NULL;
}

const uint8_t *sakura_plm_frame_y(const plm_frame_t *frame) {
	return frame == NULL ? NULL : frame->y.data;
}

const uint8_t *sakura_plm_frame_cb(const plm_frame_t *frame) {
	return frame == NULL ? NULL : frame->cb.data;
}

const uint8_t *sakura_plm_frame_cr(const plm_frame_t *frame) {
	return frame == NULL ? NULL : frame->cr.data;
}

unsigned int sakura_plm_frame_y_stride(const plm_frame_t *frame) {
	return frame == NULL ? 0 : frame->y.width;
}

unsigned int sakura_plm_frame_chroma_stride(const plm_frame_t *frame) {
	return frame == NULL ? 0 : frame->cb.width;
}
