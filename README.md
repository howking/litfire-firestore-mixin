# Firebase - Cloud Firestore mixin for LitElement

```typescript
import { LitElement, html} from '@polymer/lit-element';
import { FirestoreMixin } from './litfire-firestore-mixin.js';

class MyLitElement extends FirestoreMixin(LitElement) {
  static get properties(){
    return {
      uid: String,
      users: {
        type: Array,
        collection: 'users',
        live: true
      },
      user: {
        type: Object,
        doc: 'users/{uid}'
      }
    };
  }
  constructor(){
    super();
    this.uid='';
    this.users=[];
    this.user={};
  }
  render(){
    return html`
      <ul>
        ${this.users.map(user=>html`
          <li @click=${()=>this.uid=user.__id__}>${user.name}: ${user.age}</li>
        `)}
      </ul>
      <h4>${this.uid}</h4>
      <li>name: ${this.user ? this.user.name : ''}</li>
      <li>age: ${this.user ? this.user.age : 0}</li>
    `;
  }
}
customElements.define('my-lit-element', MyLitElement);
```

```html
<!doctype html>
<script defer src="/__/firebase/5.5.9/firebase-app.js"></script>
<script defer src="/__/firebase/5.5.9/firebase-firestore.js"></script>
<script defer src="/__/firebase/init.js"></script>
<script defer type="module" src="src/my-lit-element.js"></script>
<my-lit-element></my-lit-element>
```
