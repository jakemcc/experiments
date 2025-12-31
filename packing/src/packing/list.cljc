(ns packing.list
  (:require [clojure.set :as set]
            [clojure.string :as string]
            #?(:cljs [reagent.core :as r])
            #?(:cljs [reagent.dom :as rdom])))

(defn i
  ([s] (i :uncategorized s))
  ([category s] {:type :item :value s :category category}))

(defn a [s] {:type :action :value s})

(defn q [s yes-answer] {:type :question :value s :yes yes-answer})

(def always #{::accessories ::bathroom ::clothes})
(def global-items #{(a "Hold mail")})

;;!zprint {:format :skip}
(def packing-lists
  {::clothes #{(a "Lookup Weather")
               (i :clothing "underwear")
               (i :clothing "socks")
               (i :clothing "shoes")
               (i :clothing "t-shirts")
               (i :clothing "nice shirts")
               (i :clothing "pants")
               (i :clothing "nice pants")
               (i :clothing "suit")
               (i :clothing "lounging clothes")
               (i :clothing "bedtime clothes")
               (i :clothing "exercise clothes")}

   ::work-trip #{(i :accessories-tech "work laptop")
                 (i :accessories-tech "work phone")
                 (i :clothing "clothes for the office")
                 (i :clothing "clothes for dinners")
                 (i :accessories-tech "monitor glasses")
                 (i :travel-admin "office badge")}

   ::bouldering #{(i :climbing-gear "crash pad")
                  (i :bathroom-health "skin care")
                  (i :bathroom-health "nail file")
                  (i :climbing-gear "Twin Snakes")
                  ::outdoors}

   ::sport-climbing #{(i :climbing-gear "rope")
                      (i :climbing-gear "quick draws")
                      (i :climbing-gear "cleaning gear")
                      (i :climbing-gear "rappelling gear")
                      (i :climbing-gear "belay device")
                      (i :climbing-gear "belay specs")
                      ::outdoors}

   ::outdoors #{(i :outdoors-camping "Bug spray")
                (i :outdoors-camping "Sunscreen")
                (i :outdoors-camping "Headlamp")
                (i :clothing "sun shirt")
                (i :clothing "sun pants")
                (i :clothing "sun hat")
                (i :outdoors-camping "hand sanitizer")}

   ::camping #{(i :outdoors-camping "tent")
               (i :outdoors-camping "trash bag(s)")
               (i :outdoors-camping "tablecloth")
               ::outdoors}

   ::climbing #{::outdoors
                (q "bouldering?" ::bouldering)
                (q "sport climbing?" ::sport-climbing)
                (i :climbing-gear "chalk")
                (a "refill chalk")
                (i :climbing-gear "climbing shoes")
                (i :climbing-gear "electrolytes")
                (a "trim nails")
                (a "download offline google map")
                (a "mountain project download")}

   ::bathroom #{(i :bathroom-health "toothbrush")
                (i :bathroom-health "toothpaste")
                (i :bathroom-health "floss")
                (i :bathroom-health "Nasal spray allergy med")
                (i :bathroom-health "Benadryl")
                (i :bathroom-health "Zyrtec")
                (i :bathroom-health "Allegra (Fexofenadine)")
                (i :bathroom-health "Pepcid/Zantac/Famotidine")
                (i :bathroom-health "Auvi-Q injector")
                (i :bathroom-health "inhaler")
                (i :bathroom-health "supplements")
                (i :bathroom-health "shampoo")
                (i :bathroom-health "towel")
                (i :bathroom-health "shaving equipment / shave")}

   ::accessories #{(i :climbing-gear "portable hangboard")
                   (i :climbing-gear "force measuring device")
                   (i :accessories-tech "USB-C cable")
                   (i :accessories-tech "USB-C to HDMI cable")
                   (i :accessories-tech "USB-A cable")
                   (i :accessories-tech "travel charging block")
                   (i :accessories-tech "Whoop")
                   (i :accessories-tech "Whoop charger")
                   (i :accessories-tech "Personal laptop")
                   (i :accessories-tech "monitor glasses")
                   (i :accessories-tech "Kindle")
                   (i :accessories-tech "Remarkable")
                   (i :accessories-tech "Travel Keyboard")
                   (i :accessories-tech "headphones / headset")
                   (i :accessories-tech "ear plugs")
                   (i :accessories-tech "sun glasses")
                   (i :clothing "hat")
                   (i :accessories-tech "corkscrew")
                   (i :accessories-tech "coffee mug")
                   (i :travel-admin "global entry card")
                   (i :travel-admin "passport")
                   (a "Download podcasts")
                   (a "Download videos")
                   (a "Download books")
                   (a "Lookup Weather")}})

(def category-order
  [:clothing
   :bathroom-health
   :accessories-tech
   :outdoors-camping
   :climbing-gear
   :travel-admin
   :uncategorized])

(def category-labels
  {:clothing "Clothing"
   :bathroom-health "Bathroom & health"
   :accessories-tech "Accessories & tech"
   :outdoors-camping "Outdoors & camping"
   :climbing-gear "Climbing gear"
   :travel-admin "Travel & admin"
   :uncategorized "Other"})

(defn items-by-category
  [items]
  (let [category-set (set category-order)
        normalize-category (fn [category]
                             (if (contains? category-set category)
                               category
                               :uncategorized))
        normalize-item (fn [item]
                         (update item :category normalize-category))
        grouped (group-by :category (map normalize-item items))]
    (->> category-order
         (keep (fn [category]
                 (when-let [items (seq (get grouped category))]
                   {:category category
                    :items (sort-by :value items)}))))))

(defn bucket-by
  [pred xs]
  (let [r (group-by pred xs)]
    (assert (<= (count (keys r)) 2))
    [(get r true) (get r false)]))

(defn packing-list'
  ([lists type] (packing-list' lists type #{}))
  ([lists type seen-types]
   (let [[types other] (bucket-by keyword? (get lists type))
         types (set types)
         new-types (clojure.set/difference types seen-types)]
     (apply clojure.set/union
            (set other)
            (mapv #(packing-list' lists % (clojure.set/union seen-types types))
                  new-types)))))

(defn new-state [] {:trip-types #{} :checked-items #{}})

#?(:cljs (defonce state (r/atom (new-state))))

#?(:cljs (defn load-from-hash
           []
           (let [hash (.-hash js/location)
                 hash (js/decodeURIComponent (subs hash 1))]
             (println hash)
             (try (if (string/blank? hash)
                    (new-state)
                    (-> (js/atob hash)
                        (read-string)
                        (update :trip-types set)
                        (update :checked-items set)))
                  (catch js/Error _ (new-state))))))

#?(:cljs (defn set-hash!
           [m]
           ;; Encode state as base64 to keep the hash short(ish) and less
           ;; readable.
           (set! (.-hash js/location)
                 (js/encodeURIComponent (js/btoa (pr-str m))))))

#?(:cljs (add-watch state
                    :state-changed
                    (fn [k ref old new] (prn new) (set-hash! new))))

(defn toggle-membership
  [s type]
  (if (contains? s type) (disj s type) (conj s type)))

#?(:cljs (defn toggle-trip-type
           [type]
           (swap! state update :trip-types toggle-membership type)))

#?(:cljs (defn trip-selected [type] (contains? (:trip-types @state) type)))

#?(:cljs (defn trip-types [] (:trip-types @state)))

#?(:cljs (defn item-key [item] [(:type item) (:value item)]))

#?(:cljs
   (defn checked? [item] (contains? (:checked-items @state) (item-key item))))

#?(:cljs
   (defn toggle-item
     [item]
     (swap! state update :checked-items toggle-membership (item-key item))))

(defn- k= [k x] (fn [m] (= x (get m k))))

(def subcategory-trip-types
  (set (keep :yes (reduce set/union (vals packing-lists)))))

(def root-trip-types
  (clojure.set/difference (set (keys packing-lists)) subcategory-trip-types))

#?(:cljs
   (defn my-component
     []
     [:div.app-shell
      [:header.hero [:span.eyebrow "Packing helper"]
       [:h1 "Pack once, pack right"]
       [:p
        "Pick the trip types that apply and check things off as you pack. The URL is your list, so to continue on another device, share your URL."]]
      [:div#actions.action-bar
       [:button {:on-click #(reset! state (new-state))} "Reset list"]]
      [:section.section [:div.section-head [:h2 "Trip Categories"]]
       [:div#trip-types.trip-grid
        (for [type root-trip-types]
          ^{:key type}
          [:div.trip-card
           [:label.list-label
            [:input
             {:type "checkbox"
              :checked (trip-selected type)
              :on-change #(toggle-trip-type type)}] (name type)]])]]
      (let [[items others] (->> (trip-types)
                                (mapv (partial packing-list' packing-lists))
                                (reduce clojure.set/union)
                                (clojure.set/union global-items)
                                (bucket-by (k= :type :item)))
            questions (sort-by :value (filter (k= :type :question) others))
            actions (sort-by :value (filter (k= :type :action) others))
            grouped-items (items-by-category items)]
        [:section.section
         [:div.section-head [:h2 "Packing list"]
          [:p "Tap items to mark them as taken care of."]]
         [:div#list
          (when (seq questions)
            [:div.list-group
             [:h3 "Questions"]
             [:ul
              (for [i questions]
                ^{:key i}
                [:div.list-item
                 [:label.list-label
                  [:input
                   {:type "checkbox"
                    :checked (trip-selected (:yes i))
                    :on-change #(toggle-trip-type (:yes i))}]
                  [:span.pill "Add"]
                  [:span.item-text (:value i)]]])]])
          (when (seq actions)
            [:div.list-group
             [:h3 "Actions"]
             [:ul
              (for [i actions]
                ^{:key i}
                [:div.list-item
                 [:label.list-label
                  [:input
                   {:type "checkbox"
                    :checked (checked? i)
                    :on-change #(toggle-item i)}]
                  [:span.pill "Todo"]
                  [:span.item-text (:value i)]]])]])
          (for [{:keys [category items]} grouped-items]
            ^{:key category}
            [:div.list-group
             [:h3 (get category-labels category)]
             [:ul
              (for [i items]
                ^{:key i}
                [:div.list-item
                 [:label.list-label
                  [:input
                   {:type "checkbox"
                    :checked (checked? i)
                    :on-change #(toggle-item i)}]
                  [:span.item-text (:value i)]]])]])]])]))

#?(:cljs (do (reset! state (load-from-hash))
             (rdom/render [my-component] (.getElementById js/document "app"))))
