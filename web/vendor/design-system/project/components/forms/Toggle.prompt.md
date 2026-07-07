Switch toggle — green on, zinc off. Use `variant="horizontal"` for settings rows with label + description on the left.

```jsx
<Toggle size="md" variant="horizontal" label="Limit messages per day"
  description="Restrict this user to N chats per 24h." enabled={on} onChange={setOn} />
```
