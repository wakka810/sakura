const IMAGE_DIRECTORY_ENTRY_RESOURCE = 2;
const RT_ICON = 3;
const RT_GROUP_ICON = 14;

export function extractIconFromPe(input) {
  const pe = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const peOffset = readU32(pe, 0x3c);
  if (peOffset === null || pe.subarray(peOffset, peOffset + 4).toString("binary") !== "PE\0\0") {
    return null;
  }

  const coffOffset = peOffset + 4;
  const sectionCount = readU16(pe, coffOffset + 2);
  const optionalHeaderSize = readU16(pe, coffOffset + 16);
  if (sectionCount === null || optionalHeaderSize === null) {
    return null;
  }

  const optionalOffset = coffOffset + 20;
  const optionalMagic = readU16(pe, optionalOffset);
  const dataDirectoryOffset = optionalMagic === 0x20b
    ? optionalOffset + 112
    : optionalMagic === 0x10b
      ? optionalOffset + 96
      : -1;
  if (dataDirectoryOffset < 0) {
    return null;
  }

  const resourceDirectory = dataDirectoryOffset + IMAGE_DIRECTORY_ENTRY_RESOURCE * 8;
  const resourceRva = readU32(pe, resourceDirectory);
  const resourceSize = readU32(pe, resourceDirectory + 4);
  if (!resourceRva || !resourceSize) {
    return null;
  }

  const sectionOffset = optionalOffset + optionalHeaderSize;
  const sections = readSections(pe, sectionOffset, sectionCount);
  const resourceOffset = rvaToOffset(resourceRva, sections);
  if (resourceOffset === null || resourceOffset >= pe.length) {
    return null;
  }

  const resources = readResources(pe, resourceOffset, resourceRva);
  const iconImages = new Map(resources
    .filter((resource) => resource.typeId === RT_ICON)
    .map((resource) => [resource.nameId, resource.data]));
  const groups = resources
    .filter((resource) => resource.typeId === RT_GROUP_ICON)
    .map((resource) => parseGroupIcon(resource.data))
    .filter(Boolean)
    .sort((a, b) => groupScore(b) - groupScore(a));

  for (const group of groups) {
    const ico = buildIco(group, iconImages);
    if (ico) {
      return ico;
    }
  }
  return null;
}

function readSections(pe, offset, count) {
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    const sectionOffset = offset + index * 40;
    if (sectionOffset + 40 > pe.length) {
      break;
    }
    const virtualSize = readU32(pe, sectionOffset + 8) ?? 0;
    const virtualAddress = readU32(pe, sectionOffset + 12) ?? 0;
    const rawSize = readU32(pe, sectionOffset + 16) ?? 0;
    const rawOffset = readU32(pe, sectionOffset + 20) ?? 0;
    sections.push({
      virtualAddress,
      virtualSize,
      rawSize,
      rawOffset,
    });
  }
  return sections;
}

function rvaToOffset(rva, sections) {
  for (const section of sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      return section.rawOffset + (rva - section.virtualAddress);
    }
  }
  return null;
}

function readResources(pe, resourceOffset, resourceRva) {
  const out = [];
  const root = readResourceDirectory(pe, resourceOffset, resourceOffset);
  for (const typeEntry of root) {
    if (!typeEntry.directory || typeEntry.id === null) {
      continue;
    }
    const names = readResourceDirectory(pe, resourceOffset + typeEntry.offset, resourceOffset);
    for (const nameEntry of names) {
      if (!nameEntry.directory || nameEntry.id === null) {
        continue;
      }
      const languages = readResourceDirectory(pe, resourceOffset + nameEntry.offset, resourceOffset);
      for (const languageEntry of languages) {
        if (languageEntry.directory) {
          continue;
        }
        const data = readResourceData(pe, resourceOffset + languageEntry.offset, resourceRva, resourceOffset);
        if (data) {
          out.push({
            typeId: typeEntry.id,
            nameId: nameEntry.id,
            languageId: languageEntry.id,
            data,
          });
        }
      }
    }
  }
  return out;
}

function readResourceDirectory(pe, directoryOffset, resourceOffset) {
  if (directoryOffset + 16 > pe.length || directoryOffset < resourceOffset) {
    return [];
  }
  const namedCount = readU16(pe, directoryOffset + 12) ?? 0;
  const idCount = readU16(pe, directoryOffset + 14) ?? 0;
  const count = namedCount + idCount;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = directoryOffset + 16 + index * 8;
    if (entryOffset + 8 > pe.length) {
      break;
    }
    const rawName = readU32(pe, entryOffset) ?? 0;
    const rawTarget = readU32(pe, entryOffset + 4) ?? 0;
    const isNamed = (rawName & 0x80000000) !== 0;
    const directory = (rawTarget & 0x80000000) !== 0;
    entries.push({
      id: isNamed ? null : rawName & 0xffff,
      directory,
      offset: rawTarget & 0x7fffffff,
    });
  }
  return entries;
}

function readResourceData(pe, dataEntryOffset, resourceRva, resourceOffset) {
  if (dataEntryOffset + 16 > pe.length) {
    return null;
  }
  const dataRva = readU32(pe, dataEntryOffset);
  const size = readU32(pe, dataEntryOffset + 4);
  if (dataRva === null || size === null) {
    return null;
  }
  const dataOffset = resourceOffset + (dataRva - resourceRva);
  if (dataOffset < 0 || size < 0 || dataOffset + size > pe.length) {
    return null;
  }
  return pe.subarray(dataOffset, dataOffset + size);
}

function parseGroupIcon(data) {
  if (data.length < 6 || readU16(data, 0) !== 0 || readU16(data, 2) !== 1) {
    return null;
  }
  const count = readU16(data, 4) ?? 0;
  if (count < 1 || 6 + count * 14 > data.length) {
    return null;
  }
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 14;
    entries.push({
      width: data[offset],
      height: data[offset + 1],
      colorCount: data[offset + 2],
      reserved: data[offset + 3],
      planes: readU16(data, offset + 4) ?? 0,
      bitCount: readU16(data, offset + 6) ?? 0,
      bytesInRes: readU32(data, offset + 8) ?? 0,
      iconId: readU16(data, offset + 12) ?? 0,
    });
  }
  return entries;
}

function buildIco(groupEntries, iconImages) {
  const resolved = [];
  for (const entry of groupEntries) {
    const data = iconImages.get(entry.iconId);
    if (!data || data.length === 0) {
      return null;
    }
    resolved.push({ entry, data });
  }

  const headerSize = 6 + resolved.length * 16;
  const totalSize = headerSize + resolved.reduce((sum, item) => sum + item.data.length, 0);
  const ico = Buffer.alloc(totalSize);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(resolved.length, 4);

  let imageOffset = headerSize;
  for (let index = 0; index < resolved.length; index += 1) {
    const { entry, data } = resolved[index];
    const offset = 6 + index * 16;
    ico[offset] = entry.width;
    ico[offset + 1] = entry.height;
    ico[offset + 2] = entry.colorCount;
    ico[offset + 3] = entry.reserved;
    ico.writeUInt16LE(entry.planes, offset + 4);
    ico.writeUInt16LE(entry.bitCount, offset + 6);
    ico.writeUInt32LE(data.length, offset + 8);
    ico.writeUInt32LE(imageOffset, offset + 12);
    data.copy(ico, imageOffset);
    imageOffset += data.length;
  }
  return ico;
}

function groupScore(group) {
  return group.reduce((score, entry) => {
    const width = entry.width === 0 ? 256 : entry.width;
    const height = entry.height === 0 ? 256 : entry.height;
    return Math.max(score, width * height * Math.max(1, entry.bitCount));
  }, 0);
}

function readU16(buffer, offset) {
  return offset >= 0 && offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : null;
}

function readU32(buffer, offset) {
  return offset >= 0 && offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;
}
