Centered modal dialog — dark backdrop, bordered bg-secondary card, header with X, scroll body, optional footer for Cancel/confirm.

```jsx
<Modal title="Add user to instance" onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
           <Button variant="solid">Add user</Button></>}>
  <Input label="Username" />
</Modal>
```
