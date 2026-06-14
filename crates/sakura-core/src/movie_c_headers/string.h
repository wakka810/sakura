#ifndef SAKURA_MOVIE_STRING_H
#define SAKURA_MOVIE_STRING_H

#include <stddef.h>

void *sakura_movie_memcpy(void *dest, const void *src, size_t len);
void *sakura_movie_memmove(void *dest, const void *src, size_t len);
void *sakura_movie_memset(void *dest, int value, size_t len);

#define memcpy sakura_movie_memcpy
#define memmove sakura_movie_memmove
#define memset sakura_movie_memset

#endif
