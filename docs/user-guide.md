# Lectoria — User Guide

## CEIA · FIUBA — Academic Thesis Project

*June 2026*

- [Objective](#objective)
- [General Overview](#general-overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Adding your API key](#adding-your-api-key)
- [Reading a Book](#reading-a-book)
  - [1. Upload an EPUB](#1-upload-an-epub)
  - [2. Process the book](#2-process-the-book)
  - [3. Read](#3-read)
- [Features](#features)
  - [Adaptive music](#adaptive-music)
  - [Music style presets](#music-style-presets)
  - [Scene & on-demand images](#scene--on-demand-images)
  - [Reader controls](#reader-controls)
  - [Developer panel](#developer-panel)
- [Privacy and Your API Key](#privacy-and-your-api-key)
- [Limitations & FAQ](#limitations--faq)

---

## Objective

Lectoria is a **multimodal EPUB reader**: as you read, it plays **music that matches the mood
of each scene** and can generate **images** of what you are reading. The goal is for the
soundtrack and visuals to feel like they belong to the story — to respond to tension, calm,
romance, or wonder as the narrative shifts — rather than being random background.

This guide is for **readers**. It explains how to set up the app, process a book, and use the
reading features. (Developers: see the [Dev Guide](./dev-guide.md).)

## General Overview

You bring your own **Google Gemini API key**. When you add a book, Lectoria reads the whole
EPUB and uses AI to break it into *scenes*, tagging each one with an emotion, pace, and scene
type. That analysis — done once per book — is what powers the music and images while you read.

```
Upload an EPUB  ──►  Lectoria analyzes it (a few minutes)  ──►  Read with adaptive music + images
```

Nothing is shared with other users, and there are no accounts — everything runs locally
against your own API key.

## Getting Started

### Prerequisites

- A running Lectoria instance (open **http://localhost:5173** in your browser).
- A **Google Gemini API key** — get one free at [aistudio.google.com](https://aistudio.google.com/).
- One or more **EPUB** files. (PDF and other formats are not supported.)

### Adding your API key

1. Open **Settings** (top navigation).
2. Paste your **Gemini API key** into the LLM key field. The same key works for image
   generation.
3. Optionally pick a default **music style preset** (see below).

Your key is stored only in your browser and is sent directly to the AI provider on each
request. See [Privacy and Your API Key](#privacy-and-your-api-key).

## Reading a Book

### 1. Upload an EPUB

On the **Upload** page (the home page), choose an `.epub` file. Lectoria reads it and shows a
**cost estimate** — how many chapters and roughly how many tokens the analysis will use — so
you know what to expect before spending any API quota.

### 2. Process the book

Confirm to start **processing**. Lectoria runs a two-stage analysis of the book and shows
**live progress** as it goes (ingestion → characters → chapter-by-chapter scene analysis).
This typically takes **3–10 minutes** depending on book length and your API quota. You only
do this **once per book** — the result is saved, so re-opening the book later is instant.

> If you stop or the page closes mid-analysis, you can re-upload the same book and start again.

### 3. Read

When analysis finishes you land in the **reader**. The text is split into pages of about 250
words. As you move through the book, the music and (if enabled) images update to match the
current scene.

## Features

### Adaptive music

A track plays in the background and **changes with the mood of the story**. Lectoria does not
swap songs on every page — it keeps the same track through related moments and **crossfades**
to a new one when the emotional tone genuinely shifts (for example, moving from a calm scene
into a tense one). You can adjust volume or mute at any time from the player.

### Music style presets

If you'd prefer a particular musical flavor, choose a **style preset** in Settings:

| Preset | Feel |
|--------|------|
| **Auto** | No filter — uses the full library (default) |
| **Cinematic** | Orchestral, strings, brass — film scores and epic soundtracks |
| **Piano only** | Solo piano and keyboard — intimate and minimal |
| **Ambient** | Synths, pads, atmospheric textures — no vocals or drums |
| **Synthwave** | Electronic, retro synths, 80s vibes — sci-fi and neon |
| **Noir jazz** | Jazz, saxophone, blues — smoky and dark |

The preset narrows *which* tracks can play; Lectoria still matches the mood within that style.

### Scene & on-demand images

Lectoria can generate an **image for the current scene** based on what the text describes. You
can also **select any passage** of text and ask for an image of that specific moment.
Generated images are cached, so revisiting a scene reuses the existing image instead of
spending more quota.

> Image *characters* are drawn from the descriptions in the book, but Lectoria cannot
> guarantee the same character looks identical across different images — see Limitations.

### Reader controls

- **Arrow keys** (or on-screen controls) turn pages, one page at a time, with a horizontal
  slide.
- A **chapter list** overlay lets you jump between chapters.
- The **music player** offers play/pause, volume, mute, and skip-to-next-track.

### Developer panel

Press **Ctrl + D** to toggle a panel that shows the behind-the-scenes data for the current
scene: its detected emotion and pacing, the AI metadata, and why a particular music track was
chosen. It is meant for the curious (and for the thesis), and can be ignored while reading.

## Privacy and Your API Key

- Your Gemini API key is stored **only in your browser** (`localStorage`) and is sent as a
  request header straight to the AI provider. Lectoria's server **never stores** it.
- There are **no user accounts** and **no cross-device sync** — books and their analysis live
  on the machine running Lectoria.
- **Security note (thesis limitation):** browser `localStorage` is vulnerable to XSS, which is
  acceptable for an academic demo but would need hardening (e.g. httpOnly cookies or a secrets
  manager) for production use.

## Limitations & FAQ

- **Only EPUB is supported.** No PDF, no plain text, no DRM-protected files.
- **Processing costs API quota and time.** A full book runs the analysis once (3–10 minutes)
  and consumes Gemini tokens against *your* key. The cost estimate before processing helps you
  plan.
- **Music is selected, not generated.** Tracks come from a curated [MTG-Jamendo](https://mtg.github.io/mtg-jamendo-dataset/)
  library; Lectoria picks the best match, it does not compose new audio.
- **Character appearance may vary between images.** Image generation is guided by text
  descriptions only; there is no persistent character likeness across separate images.
- **Single user.** Lectoria is built for one reader at a time on a local machine — it is a
  thesis prototype, not a multi-tenant service.
