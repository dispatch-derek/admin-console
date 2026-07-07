Cyan CTA and confirm/cancel button family for the Admin Console; use for every clickable action.

```jsx
<Button variant="cta" icon={<i className="ph ph-user-plus" />}>Add user</Button>
<Button variant="solid">Save changes</Button>
<Button variant="ghost">Cancel</Button>
```

Variants: `cta` (cyan pill, the default "Add X" action), `solid` (white fill / black text — modal confirm), `ghost` (transparent cancel), `danger`, `login` (full-width white auth button — pair with `full`). Sizes `sm | md | lg` (heights 28 / 34 / 40px).
