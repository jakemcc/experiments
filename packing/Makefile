.PHONY: test build serve clean

# Run the Clojure tests (mirrors the GitHub Actions workflow)
test:
	clojure -M:test

# Build the static site assets used by GitHub Pages
build: clean test
	mkdir -p ../site/Packing
	cp -r src/packing/* ../site/Packing/

# Serve the packing app locally for development
serve:
	cd src/packing && python3 -m http.server 8000

clean:
	rm -rf ../site/Packing
