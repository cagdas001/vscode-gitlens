#!/bin/sh

echo $#
if [ "$#" -ne 1 ]; then
  echo "Usage sh $0 build"
  echo "Usage sh $0 bundle"
  echo "..."
  echo "Usage sh $0 clean"
  echo "Usage sh $0 lint"
  echo "..."
  exit
fi

cd macos-scripts && npm run $1 && cd ..
