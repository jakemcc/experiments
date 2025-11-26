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


