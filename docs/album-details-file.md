# Fixing album details with `dopamine.json`

Put a file named `dopamine.json` in an album folder to change how Dopamine shows that album, without changing your music
files. Every field is optional:

```json
{
    "albumTitle": "Deceiver Of The Gods",
    "albumArtist": "Amon Amarth",
    "year": 2013,
    "genre": ["Melodic Death Metal", "Viking Metal"],
    "discNumber": 1,
    "discCount": 2
}
```

- It applies to every song in that folder (not in its subfolders), and wins over the tags and the .cue sheet.
- `albumArtist` and `genre` can be one text or a list. `year` is a number. Disc numbers go from 1 to 999.
- Two folders "Album (CD1)" and "Album (CD2)" become one album with two discs when both files use the same `albumTitle`
  and their own `discNumber`.
- Fields Dopamine doesn't know are ignored. A value it can't use is ignored and noted in the log.
- After saving the file, refresh the collection ("Fast refresh" is enough).
