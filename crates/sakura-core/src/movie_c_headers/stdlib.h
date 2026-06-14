#ifndef SAKURA_MOVIE_STDLIB_H
#define SAKURA_MOVIE_STDLIB_H

#include <stddef.h>

void *sakura_movie_malloc(size_t len);
void *sakura_movie_realloc(void *ptr, size_t len);
void sakura_movie_free(void *ptr);

#endif
