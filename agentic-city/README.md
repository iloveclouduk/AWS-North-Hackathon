# agentic-city

A self-contained isometric "agentic city" visualization prototype: each
building represents a service domain (Lambda, DynamoDB, CloudWatch), and each
character is an agent that commutes between buildings, works inside for a
while (invisible from the street view, shown if you click the building), and
narrates what it's doing via speech bubbles. Server racks and desk computers
inside each room are clickable for a short status tooltip.

This is a static, single-file HTML/JS/Canvas artifact (`index.html`) with all
art assets inlined as base64 — open it directly in a browser, no build step.

Currently runs on scripted/simulated activity, not live AWS data.

## Assets

- City tiles, buildings, walls, floors, objects, and character sprites: from
  a custom `pixel-character` generation pack (see `generate_characters.py` /
  `generate_city.py` upstream) built for this project.

## Status

Prototype / work in progress. Not yet wired to the `iam-probe` backend in
this repo — that's the natural next step (an agent's visit to a zone could
trigger the real API call instead of a canned action).
