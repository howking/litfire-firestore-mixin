/**
 * Original: https://github.com/FirebaseExtended/polymerfire/blob/firestore/firebase-firestore-mixin.html
 */

const CONSTRUCTOR_TOKEN = Symbol('polymerfire-firestore-mixin-constructor');
const CONNECTED_CALLBACK_TOKEN = Symbol('polymerfire-firestore-mixin-connected-callback');
const PROPERTY_BINDING_REGEXP = /{([^{]+)}/g;

const isOdd = (x) => x & 1 === 1;

const parsePath = (path) => {
  const parts = path.split(PROPERTY_BINDING_REGEXP);
  let literals = [], props = [];
  parts.forEach((part, index) => {
    (isOdd(index) ? props : literals).push(part);
  })
  return {literals, props};
}

const stitch = (literals, values) => {
  let whole = '';
  for (var i = 0; i < literals.length; i++) {
    whole += literals[i];
    whole += values[i] || '';
  }
  return whole;
}

const collect = (what, which) => {
  let res = {};
  while (what) {
    res = Object.assign({}, what[which], res); // Respect prototype priority
    what = Object.getPrototypeOf(what);
  }
  return res;
};

const iDoc = (snap) => {
  if (snap.exists) {
    return Object.assign({__id__: snap.id}, snap.data());
  } else {
    return null;
  }
}

const TRANSFORMS = {
  doc: iDoc,
  collection: (snap) => snap.empty ? [] : snap.docs.map(iDoc),
}

/**
 * This mixin provides bindings to documents and collections in a
 * Cloud Firestore database through special property declarations.
 *
 * ### Basic Usage
 *
 * ```js
 * class MyElement extends Polymer.FirestoreMixin(Polymer.Element) {
 *   // ...
 *   static get properties() {
 *     return {
 *       uid: String,
 *       user: {
 *         type: Object,
 *         doc: 'users/{uid}'
 *       },
 *       messages: {
 *         type: Array,
 *         collection: 'users/{uid}/messages'
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * As you can see, specific properties have been decorated with `doc` and
 * `collection` options. These options provide full paths to documents or
 * collections in your Firestore database. When templatized with curly
 * braces (e.g. `{uid}` above), the data will be dynamically rebound as
 * the templatized properties change.
 *
 * PolymerFirestore bindings are **intentionally read-only**. Automatic
 * three-way binding (i.e. syncing changes from the element back up to
 * the database) are great for toy apps but largely an antipattern.
 *
 * In addition to loading data into the specified property, PolymerFirestore
 * also makes additional convenience properties:
 *
 * * `<propname>Ref`: a Firestore reference to the doc/collection
 * * `<propname>Ready`: will be true when all path segments are present and data has been fetched at least once
 *
 * ### Querying
 *
 * PolymerFire supports querying by supplying a builder function to the
 * `query` option. The function will be bound to the element and called with
 * the ref and element instance. For example:
 *
 * ```js
 * {
 *   uid: String,
 *   label: String,
 *   category: String,
 *   notes: {
 *     type: Array,
 *     collection: 'users/{uid}/notes',
 *     query: (q, el) => {
 *       q = q.orderBy('date', 'desc').limit(100)
 *       if (el.color) { q.where('color','==', el.color) }
 *       if (el.category) { q.where('category', '==', el.category) }
 *       return q;
 *     },
 *     observes: ['color', 'category']
 *   }
 * }
 * ```
 *
 * In the  above example, a rich query is further filtered down by other
 * properties on the element. Remember to declare each query-affecting
 * property in your `observes` option.
 *
 * ### Options
 *
 * * **doc:** *string*, the full (optionally templatized) path to a document.
 *   Property type must be defined as `Object`
 * * **collection:** *string*, the full (optionally templatized) path to
 *   a collection. Property type must be defined as `Array`.
 * * **live:** *boolean*, whether or not to continue updating the property
 *   as data changes in the database. If persistence is enabled, value of
 *   a property might be assigned twice (first from cache, then a live copy).
 *   See `noCache` if you wan't to change this behavior.
 * * **query:** *(ref: CollectionReference, el: Polymer.Element): Query*
 *   a query builder function that takes the computed collection reference and
 *   the element instance. It must return an instance of Query.
 * * **observes:** a list of properties which, if changed, should trigger
 *   a rebuild of a listener.
 * * **noCache:** cached Firestore data won't be assigned to a property
 *   value even if persistence is enabled.
 *
 * @polymer
 * @mixinFunction Polymer.FirestoreMixin
 */
export const FirestoreMixin = parent =>
  class extends parent {
    static _assertPropertyTypeCorrectness(prop) {
      const errorMessage = (listenerType, propertyType) =>
            `FirestoreMixin's ${listenerType} can only be used with properties ` +
            `of type ${propertyType}.`;
      const assert = (listenerType, propertyType) => {
        if (prop[listenerType] !== undefined && prop.type !== propertyType) {
          throw new Error(errorMessage(listenerType, propertyType.name));
        }
      }
      
      assert('doc', Object);
      assert('collection', Array);
    }
    
    constructor() {
      super();
      
      if (this[CONSTRUCTOR_TOKEN] === true) {
        return;
      }
      this[CONSTRUCTOR_TOKEN] = true;
      
      this._firestoreProps = {};
      this._firestoreListeners = {};
      // this.db = this.constructor.db || firebase.firestore();
      this._firestoreObserves = {};
      const firestore = firebase.firestore()
      firestore.settings({ timestampsInSnapshots: true })
      this.db = this.constructor.db || firestore;
    }
    
    connectedCallback() {
      if (this[CONNECTED_CALLBACK_TOKEN] !== true) {
        this[CONNECTED_CALLBACK_TOKEN] = true;
        
        const props = collect(this.constructor, 'properties');
        Object
          .values(props)
          .forEach(this.constructor._assertPropertyTypeCorrectness);
        
        for (let name in props) {
          const options = props[name];
          if (options.doc || options.collection) {
            this._firestoreBind(name, options);
          }
        }
      }
      
      super.connectedCallback();
    }
    
    _firestoreBind(name, options) {
      const defaults = {
        live: false,
        observes: [],
      }
      const parsedPath = parsePath(options.doc || options.collection);
      const config = Object.assign({}, defaults, options, parsedPath);
      const type = config.type =
            config.doc ? 'doc' : config.collection ? 'collection' : undefined;
      
      this._firestoreProps[name] = config;
      
      const args = config.props.concat(config.observes);
      if (args.length > 0) {
        // Create a method observer that will be called every time
        // a templatized or observed property changes
        // const observer =
        //       `_firestoreUpdateBinding('${name}', ${args.join(',')})`
        // this._createMethodObserver(observer);
        this._firestoreObserves[args.join (',')]=name
      }
      
      this._firestoreUpdateBinding(name, ...args.map(x => this[x]));
    }

    // LitElement
    updated(changedProperties){
      changedProperties.forEach((oldValue, propName) => {
        if(this._firestoreObserves[propName] && this[propName]){
          this._firestoreUpdateBinding(this._firestoreObserves[propName],[this[propName]])
        }
      })
    }
    
    _firestoreUpdateBinding(name, ...args) {
      this._firestoreUnlisten(name);
      
      const config = this._firestoreProps[name];
      const isDefined = (x) => x !== undefined;
      const propArgs = args.slice(0, config.props.length).filter(isDefined);
      const observesArgs = args.slice(config.props.length).filter(isDefined);
      
      const propArgsReady = propArgs.length === config.props.length;
      const observesArgsReady =
            observesArgs.length === config.observes.length;
      
      if (propArgsReady && observesArgsReady) {
        const collPath = stitch(config.literals, propArgs);
        if(collPath.endsWith('/')) return;
        const assigner = this._firestoreAssigner(name, config);
        
        let ref = this.db[config.type](collPath);
        this[name + 'Ref'] = ref;
        
        if (config.query) {
          ref = config.query.call(this, ref, this);
        }
        
        this._firestoreListeners[name] = ref.onSnapshot(assigner);
      }
    }
    
    _firestoreUnlisten(name, type) {
      if (this._firestoreListeners[name]) {
        this._firestoreListeners[name]();
        delete this._firestoreListeners[name];
      }
      
      
      // this.setProperties({
      //   [name]: type === 'collection' ? [] : null,
      //   [name + 'Ref']: null,
      //   [name + 'Ready']: false,
      // })
      this[name+'Ref'] = null
      this[name+'Ready'] = false

    }
    
    _firestoreAssigner(name, {type, live, noCache}) {
      const makeAssigner = (assigner) => (snap) => {
        const shouldAssign =
              noCache !== true || snap.metadata.fromCache === false;
        if (shouldAssign) {
          assigner.call(this, name, snap);
          this[name + 'Ready'] = true;
          if (live !== true) {
            this._firestoreListeners[name]();
          }
        }
      }
      if (type === 'doc') {
        return makeAssigner(this._firestoreAssignDocument);
      } else if (type === 'collection') {
        return makeAssigner(this._firestoreAssignCollection);
      } else {
        throw new Error('Unknown listener type.');
      }
    }
    
    _firestoreAssignDocument(name, snap) {
      this[name] = iDoc(snap);
      this.requestUpdate(name)
    }
    
    _firestoreAssignCollection(name, snap) {
      const propertyValueIsArray = Array.isArray(this[name])
      // const allDocumentsChanged = snap.docs.length === snap.docChanges.length;
      const allDocumentsChanged = snap.docs.length === snap.docChanges().length;
      if (propertyValueIsArray && allDocumentsChanged === false) {
        // snap.docChanges.forEach((change) => {
        snap.docChanges().forEach((change) => {
          switch (change.type) {
            case 'added':
              // this.splice(name, change.newIndex, 0, iDoc(change.doc));
              this[name].splice(change.newIndex, 0, iDoc(change.doc));
              break;
            case 'removed':
              // this.splice(name, change.oldIndex, 1);
              this[name].splice(change.oldIndex, 1);
              break;
            case 'modified':
              if (change.oldIndex === change.newIndex) {
                // this.splice(name, change.oldIndex, 1, iDoc(change.doc));
                this[name].splice(change.oldIndex, 1, iDoc(change.doc));
              } else {
                // this.splice(name, change.oldIndex, 1);
                // this.splice(name, change.newIndex, 0, iDoc(change.doc));
                this[name].splice(change.oldIndex, 1);
                this[name].splice(change.newIndex, 0, iDoc(change.doc));
              }
              break;
            default:
              throw new Error(`Unhandled document change: ${change.type}.`);
          }
        });
      } else {
        this[name] = snap.docs.map(iDoc);
      }
      this.requestUpdate(name)
    }
  }
