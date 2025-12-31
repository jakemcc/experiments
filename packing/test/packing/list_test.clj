(ns packing.list-test
  (:require [clojure.test :refer [deftest is testing]]
            [packing.list :as pl]))

(deftest returns-items
  (is (= #{(pl/i "shoes")}
         (pl/packing-list' {:pl/climbing #{(pl/i "shoes")}}
                           :pl/climbing))))

(deftest recursive-item-lists
  (is (= #{(pl/i "shoes")
           (pl/i "tent")}
         (pl/packing-list' {:pl/climbing #{(pl/i "shoes")
                                           :pl/outdoors}
                            :pl/outdoors #{(pl/i "tent")}}
                           :pl/climbing)))

  (is (= #{(pl/i "shoes")
           (pl/i "tent")
           (pl/i "sunscreen")}
         (pl/packing-list' {:pl/climbing #{(pl/i "shoes")
                                           :pl/camping}
                            :pl/camping #{(pl/i "tent")
                                          :pl/outdoors}
                            :pl/outdoors #{(pl/i "sunscreen")
                                           (pl/i "tent")}}
                           :pl/climbing)))

  (testing "handles mutually referencing"
    (is (= #{(pl/i "shoes")
             (pl/i "sunscreen")}
           (pl/packing-list' {:pl/climbing #{(pl/i "shoes")
                                             :pl/outdoors}
                              :pl/outdoors #{(pl/i "sunscreen")
                                             :pl/climbing}}
                             :pl/climbing)))))

(deftest item-accepts-category
  (is (= {:type :item :value "socks" :category :clothing}
         (pl/i :clothing "socks"))))

(deftest items-by-category-orders-and-sorts
  (let [items #{(pl/i :accessories-tech "charger")
                (pl/i :clothing "socks")
                (pl/i :clothing "shoes")}
        grouped (pl/items-by-category items)]
    (is (= [{:category :clothing
             :items [(pl/i :clothing "shoes")
                     (pl/i :clothing "socks")]}
            {:category :accessories-tech
             :items [(pl/i :accessories-tech "charger")]}]
           grouped))))

(deftest items-by-category-unknown-falls-back
  (let [items #{(pl/i :mystery "mystery item")}
        grouped (pl/items-by-category items)]
    (is (= [{:category :uncategorized
             :items [(pl/i :uncategorized "mystery item")]}]
           grouped))))

