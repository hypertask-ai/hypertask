FROM node:18-alpine AS dependencies

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn

FROM node:18-alpine AS build

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN rm -rf prisma

EXPOSE 3000
ENV PORT 3000

CMD [ "yarn", "dev" ]