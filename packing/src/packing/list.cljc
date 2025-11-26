(ns packing.list
  (:require [clojure.set :as set]
            [clojure.string :as string]
            #?(:cljs [reagent.core :as r])
            #?(:cljs [reagent.dom :as rdom])))

(defn i [s] {:type :item :value s})

(defn a [s] {:type :action :value s})

(defn q [s yes-answer] {:type :question :value s :yes yes-answer})

(def always #{::accessories ::bathroom ::clothes})

;;!zprint {:format :skip}
(def packing-lists
  {::clothes #{(a "Lookup Weather")
               (i "underwear")
               (i "socks")
               (i "shoes")
               (i "t-shirts")
               (i "nice shirts")
               (i "pants")
               (i "nice pants")
               (i "suit")
               (i "lounging clothes")
               (i "bedtime clothes")
               (i "exercise clothes")}

   ::work-trip #{(i "work laptop")
                 (i "work phone")
                 (i "clothes for the office")
                 (i "clothes for dinners")
                 (i "office badge")}

   ::bouldering #{(i "crash pad")
                  (i "skin care")
                  (i "nail file")
                  (i "Twin Snakes")
                  ::outdoors}

   ::sport-climbing #{(i "rope")
                      (i "quick draws")
                      (i "cleaning gear")
                      (i "rappelling gear")
                      (i "belay device")
                      (i "belay specs")
                      ::outdoors}

   ::outdoors #{(i "Bug spray")
                (i "Sunscreen")
                (i "Headlamp")
                (i "sun shirt")
                (i "sun pants")
                (i "sun hat")
                (i "hand sanitizer")}

   ::camping #{(i "tent")
               (i "trash bag(s)")
               (i "tablecloth")
               ::outdoors}

   ::climbing #{::outdoors
                (q "bouldering?" ::bouldering)
                (q "sport climbing?" ::sport-climbing)
                (i "chalk")
                (a "refill chalk")
                (i "climbing shoes")
                (i "electrolytes")
                (a "trim nails")
                (a "download offline google map")
                (a "mountain project download")}

   ::bathroom #{(i "toothbrush")
                (i "toothpaste")
                (i "floss")
                (i "Nasal spray allergy med")
                (i "Benadryl")
                (i "Zyrtec")
                (i "Allegra (Fexofenadine)")
                (i "Pepcid/Zantac/Famotidine")
                (i "supplements")
                (i "shampoo")
                (i "towel")
                (i "shaving equipment / shave")}

   ::accessories #{(i "portable hangboard")
                   (i "force measuring device")
                   (i "USB-C cable")
                   (i "USB-A cable")
                   (i "travel charging block")
                   (i "Whoop")
                   (i "Whoop charger")
                   (i "Personal laptop")
                   (i "Kindle")
                   (i "Remarkable")
                   (i "Travel Keyboard")
                   (i "headphones / headset")
                   (i "ear plugs")
                   (i "sun glasses")
                   (i "hat")
                   (i "corkscrew")
                   (i "coffee mug")
                   (i "global entry card")
                   (i "passport")
                   (a "Download podcasts")
                   (a "Download videos")
                   (a "Download books")
                   (a "Lookup Weather")}})

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
                                  (bucket-by (k= :type :item)))]
          [:section.section
           [:div.section-head [:h2 "Packing list"]
            [:p "Tap items to mark them as taken care of."]]
           [:div#list
            [:ul
             (for [i (reverse (sort-by :type others))]
               ^{:key i}
               [:div.list-item
                [:label.list-label
                 [:input
                  (cond-> {:type "checkbox"}
                    (= :question (:type i))
                    (assoc :checked (trip-selected (:yes i))
                           :on-change #(toggle-trip-type (:yes i)))
                    (not= :question (:type i))
                    (assoc :checked (checked? i) :on-change #(toggle-item i)))]
                 (when (= :action (:type i)) [:span.pill "Todo"])
                 (when (= :question (:type i)) [:span.pill "Add"])
                 [:span.item-text (:value i)]]])]
            [:ul
             (for [i (sort-by :type items)]
               ^{:key i}
               [:div.list-item
                [:label.list-label
                 [:input
                  {:type "checkbox"
                   :checked (checked? i)
                   :on-change #(toggle-item i)}]
                 (when (= :action (:type i)) [:span.pill "Todo"])
                 [:span.item-text (:value i)]]])]]])]))

#?(:cljs (do (reset! state (load-from-hash))
             (rdom/render [my-component] (.getElementById js/document "app"))))
