# Release Journey

This preview works **entirely offline** with local assets.

## Search and navigation

A distinctive cross **format** phrase appears here.

The same cross format phrase appears here too.

```typescript
const searchableCode = 'cross format';
```

## Mathematics

Inline $a^2+b^2=c^2$ and display mathematics:

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$

## Diagrams

```mermaid
flowchart LR
  A[Local source] --> B[Offline preview]
```

## Images and links

![Local test image](./assets/normal-image.svg)

![Remote privacy test](https://offline-preview-e2e.invalid/tracking.png)

[Open linked document](./linked-doc.md)

## Unsafe authored HTML

<img src="https://offline-preview-e2e.invalid/onerror.png" onerror="document.body.dataset.unsafe = 'executed'">

<script>document.body.dataset.unsafe = 'executed';</script>

<a href="javascript:document.body.dataset.unsafe='executed'">Unsafe link</a>

## Final section

This is the final section.
