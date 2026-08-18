# Build-time data

`concreteness-brysbaert-2014.txt` is the input to `scripts/build-word-lists.ts`, which generates
`src/assets/{nouns,verbs,adjectives}.ts`.

It is **never bundled into a Lambda** and is not a runtime dependency. It lives here so the
derivation is reproducible and so the CC BY attribution has an anchor. See `LICENSE`; the
generated asset files carry the citation in a header comment.

## Provenance

Downloaded from:

    https://raw.githubusercontent.com/ArtsEngine/concreteness/master/Concreteness_ratings_Brysbaert_et_al_BRM.txt

That is a mirror, not the authors' own distribution, which is why the hash below matters.

Source line endings are CRLF and were normalized to LF on download:

    tr -d '\r' < downloaded.txt > concreteness-brysbaert-2014.txt

The normalization is not cosmetic. A trailing `\r` rides on the last tab-delimited column, so every
`Dom_Pos` comparison fails silently and all three lists come out empty rather than erroring.

## Integrity

    sha256  08196a05dcaa774d49eaaf0fdf8617d4ed6cf26d2d95d92a1da9afbcecfbdf10
    lines   39,955 (including the header)

`build-word-lists.ts` verifies this hash before parsing and throws on a mismatch. Verify by hand:

    shasum -a 256 scripts/data/concreteness-brysbaert-2014.txt

**What the hash does and does not prove.** It pins what we vendored, so a later swap or truncation
fails loudly. It says nothing about whether the mirror matched the authors' own distribution at
download time — it was computed from the mirror, so an alteration made before we fetched would be
blessed permanently.

The corroborating evidence, which is checkable against the published paper rather than against us:

- 37,058 single words and 2,896 two-word expressions, matching the counts in Brysbaert et al. (2014)
- all 39,954 data rows have exactly 9 tab-separated fields
- `Bigram` is always 0 or 1, and `Conc.M` is numeric in every row

Worth cross-checking once against the authors' distribution (crr.ugent.be, or the Springer
supplementary material) and recording the result here.
