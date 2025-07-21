// DynamoDB

process.env.DYNAMODB_GAMES_TABLE_NAME = 'games-table'
process.env.DYNAMODB_PROMPTS_TABLE_NAME = 'prompts-table'

// Lambda

process.env.CREATE_GAME_FUNCTION_NAME = 'create-game-function'

// LLM

process.env.LLM_PROMPT_ID = 'create-connections-game'

// Games

process.env.AVOID_NEXT_GAMES_COUNT = '10'
process.env.AVOID_PAST_GAMES_COUNT = '20'
process.env.INSPIRATION_ADJECTIVES_COUNT = '5'
process.env.INSPIRATION_NOUNS_COUNT = '20'
process.env.INSPIRATION_TIME_PERIODS_COUNT = '3'
process.env.INSPIRATION_VERBS_COUNT = '10'

// Logging

process.env.DEBUG_LOGGING = 'true'
